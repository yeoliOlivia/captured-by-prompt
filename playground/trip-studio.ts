import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { COLLECTION_LIMIT } from '@captured/core/current';

// This is one local workspace. Trip membership is photo organization, not account access.
export type StudioPhoto = {
  id: string; name: string; indexed?: boolean; capturedAt?: string | null;
  place?: { lat: number; lon: number } | null;
};
const PhotoId = z.string().regex(/^[a-f0-9]{64}$/);
const PhotoIds = z.array(PhotoId).max(COLLECTION_LIMIT);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date.');
const OptionalDay = z.union([Day, z.literal('')]).default('');
const Label = z.string().trim().min(1).max(80);
const Labels = z.array(Label).max(20).default([]);
const MemberInput = z.object({
  name: Label, qualifier: z.string().trim().max(120).default(''),
  referencePhotoIds: PhotoIds.refine(ids => ids.length <= 12, 'Choose at most 12 references.').default([]),
}).strict();
const TripInput = z.object({
  title: z.string().trim().min(1).max(140), place: z.string().trim().max(160).default(''),
  description: z.string().trim().max(2000).default(''),
  startDate: OptionalDay, endDate: OptionalDay,
  members: z.array(MemberInput).max(30).default([]), photoIds: PhotoIds.default([]),
}).strict().refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, 'End date precedes start date.');
const Presence = z.object({
  memberId: z.string().uuid(), status: z.enum(['confirmed', 'suggested', 'uncertain']),
}).strict();
export const StudioAnnotationInput = z.object({
  photoId: PhotoId, revision: z.number().int().nonnegative().default(0),
  provenance: z.enum(['user', 'model']), model: z.string().trim().min(1).max(160).nullable().default(null),
  evidence: z.string().trim().max(2000).nullable().default(null),
  activities: Labels, vibes: Labels,
  scene: z.enum(['people', 'scenery', 'food', 'other']).nullable().default(null),
  aesthetic: z.number().finite().min(0).max(100).nullable().default(null),
  smilesVisible: z.boolean().nullable().default(null), facesClear: z.boolean().nullable().default(null),
  members: z.array(Presence).max(30).default([]),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.members.map(member => member.memberId)).size !== value.members.length) {
    ctx.addIssue({ code: 'custom', message: 'Include each person at most once per photo.' });
  }
  if (value.provenance === 'model' && (!value.model || !value.evidence)) {
    ctx.addIssue({ code: 'custom', message: 'Model observations require a model name and evidence.' });
  }
  if (value.provenance === 'model' && value.members.some(member => member.status === 'confirmed')) {
    ctx.addIssue({ code: 'custom', message: 'A person must be confirmed by the user, not a model.' });
  }
});
const ShortlistInput = z.object({
  scene: z.enum(['people', 'scenery', 'food', 'other']).optional(),
  confirmedPerson: z.string().uuid().optional(), activities: Labels, vibes: Labels,
  smilesVisible: z.boolean().optional(), facesClear: z.boolean().optional(),
  rank: z.enum(['aesthetic', 'faces', 'recent']).default('recent'),
  limit: z.number().int().min(1).max(500).default(60),
}).strict();
type Member = z.infer<typeof MemberInput> & { id: string };
export type StudioTrip = Omit<z.infer<typeof TripInput>, 'members' | 'photoIds'> & {
  id: string; members: Member[]; revision: number; createdAt: string; updatedAt: string;
};
export type StudioAnnotation = z.infer<typeof StudioAnnotationInput> & {
  schemaVersion: 1; revision: number; updatedAt: string;
};
class StudioError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
const unique = <T>(values: T[]) => [...new Set(values)];
const labels = (values: string[]) => unique(values.map(value => value.normalize('NFKC').toLocaleLowerCase('en')));
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function openTripStudio(datasetDir: string, getPhotos: () => readonly StudioPhoto[]) {
  mkdirSync(datasetDir, { recursive: true });
  const path = resolve(datasetDir, '.trip-studio.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) > 1) {
    db.close();
    throw new Error('This trip workspace was created by a newer app version. Update the app before opening it.');
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS studio_trips (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_photos (
      trip_id TEXT NOT NULL REFERENCES studio_trips(id), photo_id TEXT NOT NULL,
      added_at TEXT NOT NULL, PRIMARY KEY(trip_id, photo_id));
    CREATE TABLE IF NOT EXISTS studio_annotations (
      trip_id TEXT NOT NULL, photo_id TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(trip_id, photo_id), FOREIGN KEY(trip_id, photo_id) REFERENCES studio_photos(trip_id, photo_id));
    PRAGMA user_version=1;`);
  const transaction = <T>(operation: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const library = () => new Map(getPhotos().map(photo => [photo.id, photo]));
  const trip = (id: string): StudioTrip => {
    const row = db.prepare('SELECT data FROM studio_trips WHERE id=?').get(id);
    if (!row) throw new StudioError('Trip not found.', 404);
    return JSON.parse(String(row.data));
  };
  const photoIds = (id: string): string[] => db.prepare('SELECT photo_id FROM studio_photos WHERE trip_id=? ORDER BY rowid').all(id).map(row => String(row.photo_id));
  const annotations = (id: string): Map<string, StudioAnnotation> => new Map(db.prepare('SELECT photo_id,data FROM studio_annotations WHERE trip_id=?').all(id).map(row => [String(row.photo_id), JSON.parse(String(row.data))]));
  const writeTrip = (value: StudioTrip) => db.prepare('INSERT INTO studio_trips VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value));
  const touch = (value: StudioTrip) => { value.revision++; value.updatedAt = new Date().toISOString(); writeTrip(value); };
  const validatePhotos = (ids: string[], available: Map<string, StudioPhoto>) => {
    if (ids.some(id => !available.has(id))) throw new StudioError('Choose photos from the current library.');
  };
  const validateReferences = (members: z.infer<typeof MemberInput>[], ids: Set<string>) => {
    if (members.some(member => member.referencePhotoIds.some(id => !ids.has(id)))) throw new StudioError('Person reference photos must belong to this trip.');
  };
  function details(id: string) {
    const value = trip(id), available = library(), observed = annotations(id), ids = photoIds(id);
    const photos = ids.flatMap(photoId => {
      const photo = available.get(photoId);
      if (!photo) return [];
      const place = photo.place && Number.isFinite(photo.place.lat) && Number.isFinite(photo.place.lon) && Math.abs(photo.place.lat) <= 90 && Math.abs(photo.place.lon) <= 180 ? photo.place : null;
      return [{ id: photo.id, name: photo.name, image: `/photos/${photo.id}`, indexed: photo.indexed === true, capturedAt: photo.capturedAt ?? null, place, annotation: observed.get(photoId) ?? null }];
    });
    const covered = photos.filter(photo => photo.annotation !== null);
    return {
      trip: { ...value, photoCount: ids.length }, photos,
      coverage: {
        indexedPhotos: photos.filter(photo => photo.indexed).length, totalPhotos: ids.length, availablePhotos: photos.length, unavailablePhotos: ids.length - photos.length,
        annotatedPhotos: covered.length, unannotatedPhotos: photos.length - covered.length,
        userAnnotatedPhotos: covered.filter(photo => photo.annotation!.provenance === 'user').length,
        modelAnnotatedPhotos: covered.filter(photo => photo.annotation!.provenance === 'model').length,
        aestheticPhotos: covered.filter(photo => photo.annotation!.aesthetic !== null).length,
        facesAssessedPhotos: covered.filter(photo => photo.annotation!.facesClear !== null).length,
        smilesAssessedPhotos: covered.filter(photo => photo.annotation!.smilesVisible !== null).length,
        locationPhotos: photos.filter(photo => photo.place !== null).length,
      },
    };
  }
  return {
    close: () => db.close(),
    list() {
      return db.prepare('SELECT data FROM studio_trips ORDER BY rowid DESC').all().map(row => {
        const value: StudioTrip = JSON.parse(String(row.data));
        const count = db.prepare('SELECT count(*) AS count FROM studio_photos WHERE trip_id=?').get(value.id);
        return { ...value, photoCount: Number(count!.count) };
      });
    },
    create(value: unknown) {
      const input = TripInput.parse(value);
      return transaction(() => {
        const ids = unique(input.photoIds), available = library();
        validatePhotos(ids, available); validateReferences(input.members, new Set(ids));
        if (Number(db.prepare('SELECT count(*) AS count FROM studio_trips').get()!.count) >= 200) throw new StudioError('This local workspace supports 200 trips.');
        const now = new Date().toISOString(), { photoIds: _ids, members, ...fields } = input;
        const valueToSave: StudioTrip = { ...fields, id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, members: members.map(member => ({ ...member, referencePhotoIds: unique(member.referencePhotoIds), id: randomUUID() })) };
        writeTrip(valueToSave);
        const insert = db.prepare('INSERT INTO studio_photos VALUES (?,?,?)');
        for (const id of ids) insert.run(valueToSave.id, id, now);
        return { ...valueToSave, photoCount: ids.length };
      });
    },
    details,
    attach(id: string, value: unknown) {
      const { photoIds: input } = z.object({ photoIds: PhotoIds }).strict().parse(value);
      return transaction(() => {
        const valueToUpdate = trip(id), ids = unique(input), existing = new Set(photoIds(id));
        validatePhotos(ids, library());
        if (new Set([...existing, ...ids]).size > COLLECTION_LIMIT) throw new StudioError('Trip photo limit reached.');
        const additions = ids.filter(photoId => !existing.has(photoId));
        const insert = db.prepare('INSERT INTO studio_photos VALUES (?,?,?)');
        for (const photoId of additions) insert.run(id, photoId, new Date().toISOString());
        if (additions.length) touch(valueToUpdate);
        return { trip: { ...valueToUpdate, photoCount: existing.size + additions.length }, added: additions.length };
      });
    },
    addMember(id: string, value: unknown) {
      const input = MemberInput.parse(value);
      return transaction(() => {
        const valueToUpdate = trip(id);
        if (valueToUpdate.members.length >= 30) throw new StudioError('A trip supports 30 named people.');
        validateReferences([input], new Set(photoIds(id)));
        validatePhotos(input.referencePhotoIds, library());
        const member = { ...input, referencePhotoIds: unique(input.referencePhotoIds), id: randomUUID() };
        valueToUpdate.members.push(member); touch(valueToUpdate);
        return { member, trip: { ...valueToUpdate, photoCount: photoIds(id).length } };
      });
    },
    annotate(id: string, value: unknown) {
      const input = z.object({ annotations: z.array(StudioAnnotationInput).min(1).max(500) }).strict().parse(value);
      if (new Set(input.annotations.map(item => item.photoId)).size !== input.annotations.length) throw new StudioError('Include each photo only once in an annotation batch.');
      // Acquire the write lock before reading revisions or scope. A second server
      // must re-check current data after the first writer commits.
      return transaction(() => {
        const valueToUpdate = trip(id), scope = new Set(photoIds(id)), available = library(), previous = annotations(id);
        const memberIds = new Set(valueToUpdate.members.map(member => member.id));
        for (const item of input.annotations) {
          if (!scope.has(item.photoId) || !available.has(item.photoId)) throw new StudioError('Annotations must refer to available photos in this trip.');
          if (item.members.some(member => !memberIds.has(member.memberId))) throw new StudioError('Choose people from this trip.');
          const old = previous.get(item.photoId);
          if ((old?.revision ?? 0) !== item.revision) throw new StudioError('This photo was updated. Reload before saving your changes.', 409);
          if (old?.provenance === 'user' && item.provenance === 'model') throw new StudioError('Model observations cannot overwrite a user correction.', 409);
        }
        const now = new Date().toISOString();
        const saved: StudioAnnotation[] = input.annotations.map(item => ({ ...item, activities: labels(item.activities), vibes: labels(item.vibes), revision: item.revision + 1, schemaVersion: 1, updatedAt: now }));
        const insert = db.prepare('INSERT INTO studio_annotations VALUES (?,?,?) ON CONFLICT(trip_id,photo_id) DO UPDATE SET data=excluded.data');
        for (const item of saved) insert.run(id, item.photoId, JSON.stringify(item));
        touch(valueToUpdate);
        return { annotations: saved };
      });
    },
    insights(id: string) {
      const { trip: value, photos, coverage } = details(id);
      const observed = photos.flatMap(photo => photo.annotation ? [photo.annotation] : []);
      const counts = (getLabels: (item: StudioAnnotation) => string[]) => {
        const items = new Map<string, number>();
        for (const item of observed) for (const label of unique(getLabels(item))) items.set(label, (items.get(label) ?? 0) + 1);
        return [...items].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      };
      const people = value.members.map(member => {
        const presence = observed.flatMap(item => item.members.filter(person => person.memberId === member.id));
        return { id: member.id, name: member.name, qualifier: member.qualifier, confirmedPhotos: presence.filter(person => person.status === 'confirmed').length, suggestedPhotos: presence.filter(person => person.status === 'suggested').length, uncertainPhotos: presence.filter(person => person.status === 'uncertain').length };
      }).sort((a, b) => b.confirmedPhotos - a.confirmedPhotos || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const locations = new Map<string, { lat: number; lon: number; photoIds: string[] }>();
      for (const photo of photos) if (photo.place) {
        const lat = Math.round(photo.place.lat * 100) / 100, lon = Math.round(photo.place.lon * 100) / 100, key = `${lat},${lon}`;
        const group = locations.get(key) ?? { lat, lon, photoIds: [] };
        group.photoIds.push(photo.id); locations.set(key, group);
      }
      return {
        tripId: id, coverage, people, activities: counts(item => item.activities), vibes: counts(item => item.vibes),
        scenes: counts(item => item.scene ? [item.scene] : []),
        smilesVisiblePhotos: observed.filter(item => item.smilesVisible === true).length,
        facesClearPhotos: observed.filter(item => item.facesClear === true).length,
        locations: [...locations.values()],
      };
    },
    shortlist(id: string, value: unknown) {
      const input = ShortlistInput.parse(value), data = details(id);
      if (input.confirmedPerson && !data.trip.members.some(member => member.id === input.confirmedPerson)) throw new StudioError('Choose a person from this trip.');
      const activities = labels(input.activities), vibes = labels(input.vibes);
      const candidates = data.photos.filter(photo => {
        const item = photo.annotation;
        if (input.scene && item?.scene !== input.scene) return false;
        if (input.confirmedPerson && !item?.members.some(member => member.memberId === input.confirmedPerson && member.status === 'confirmed')) return false;
        if (activities.some(activity => !item?.activities.includes(activity)) || vibes.some(vibe => !item?.vibes.includes(vibe))) return false;
        if (hasOwn(input, 'smilesVisible') && item?.smilesVisible !== input.smilesVisible) return false;
        if (hasOwn(input, 'facesClear') && item?.facesClear !== input.facesClear) return false;
        if (input.rank === 'aesthetic' && (item?.aesthetic == null)) return false;
        if (input.rank === 'faces' && (item?.facesClear == null)) return false;
        return true;
      });
      candidates.sort((a, b) => {
        let compared = 0;
        if (input.rank === 'aesthetic') compared = b.annotation!.aesthetic! - a.annotation!.aesthetic!;
        if (input.rank === 'faces') compared = Number(b.annotation!.facesClear) - Number(a.annotation!.facesClear);
        if (!compared) compared = (b.capturedAt ?? '').localeCompare(a.capturedAt ?? '');
        return compared || a.id.localeCompare(b.id);
      });
      return { photos: candidates.slice(0, input.limit), coverage: data.coverage, matching: candidates.length, total: data.photos.length, rank: input.rank };
    },
    exportSelection(id: string, value: unknown) {
      const input = z.object({ photoIds: PhotoIds.min(1), confirmedPerson: z.string().uuid().optional() }).strict().parse(value);
      const data = details(id), scope = new Map(data.photos.map(photo => [photo.id, photo]));
      const recipient = input.confirmedPerson ? data.trip.members.find(member => member.id === input.confirmedPerson) : undefined;
      if (input.confirmedPerson && !recipient) throw new StudioError('Choose a person from this trip.');
      const selected = unique(input.photoIds).map(photoId => {
        const photo = scope.get(photoId);
        if (!photo) throw new StudioError('Export only available photos from this trip.');
        if (recipient && !photo.annotation?.members.some(member => member.memberId === recipient.id && member.status === 'confirmed')) throw new StudioError('Confirm this person appears in every photo before preparing their selection.');
        return { id: photo.id, name: photo.name, image: photo.image };
      });
      return { schemaVersion: 1, tripId: id, tripTitle: data.trip.title, recipient: recipient ? { id: recipient.id, name: recipient.name, qualifier: recipient.qualifier } : null, photos: selected, delivery: 'not-sent', createdAt: new Date().toISOString() };
    },
  };
}

export function registerTripStudio(server: FastifyInstance, options: { datasetDir: string; getPhotos: () => readonly StudioPhoto[] }) {
  const store = openTripStudio(options.datasetDir, options.getPhotos);
  const path = '/api/studio/trips';
  server.addHook('onClose', async () => store.close());
  const call = (operation: (request: FastifyRequest) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    try { return operation(request); }
    catch (error) {
      if (error instanceof StudioError) return reply.code(error.statusCode).send({ message: error.message });
      if (error instanceof z.ZodError) return reply.code(400).send({ message: error.issues.map(issue => issue.message).join(' ') });
      throw error;
    }
  };
  const id = (request: { params: unknown }) => z.object({ id: z.string().uuid() }).parse(request.params).id;
  server.get(path, call(() => ({ trips: store.list() })));
  server.post(path, call(request => ({ trip: store.create(request.body) })));
  server.get(`${path}/:id`, call(request => store.details(id(request))));
  server.post(`${path}/:id/photos`, call(request => store.attach(id(request), request.body)));
  server.post(`${path}/:id/members`, call(request => store.addMember(id(request), request.body)));
  server.post(`${path}/:id/annotations`, call(request => store.annotate(id(request), request.body)));
  server.get(`${path}/:id/insights`, call(request => store.insights(id(request))));
  server.post(`${path}/:id/shortlist`, call(request => store.shortlist(id(request), request.body)));
  server.post(`${path}/:id/export`, call(request => store.exportSelection(id(request), request.body)));
  return store;
}
