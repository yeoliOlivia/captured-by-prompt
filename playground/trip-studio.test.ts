import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { openTripStudio, registerTripStudio, type StudioPhoto } from './trip-studio.js';
import { createPlaygroundServer } from './server.js';

const ids = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(64));
const photos: StudioPhoto[] = ids.map((id, index) => ({ id, name: `${index}.jpg`, capturedAt: index < 2 ? '2026-07-01T15:00:00' : null, place: index === 0 ? { lat: 35.68, lon: 139.76 } : null }));
const directories: string[] = [];
const cleanup: (() => void | Promise<unknown>)[] = [];
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'captured-studio-'));
  directories.push(path); return path;
};
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const setup = async () => {
  const path = await directory(), store = openTripStudio(path, () => photos);
  cleanup.push(() => store.close());
  return store;
};

describe('local trip studio', () => {
  it('persists explicitly attached photos and stable people without treating a filename as identity', async () => {
    const path = await directory();
    let store = openTripStudio(path, () => photos);
    const trip = store.create({ title: 'Japan', place: 'Tokyo', photoIds: [ids[0], ids[0]], members: [{ name: 'Mark', qualifier: 'college', referencePhotoIds: [ids[0]] }] });
    const member = trip.members[0];
    expect(trip.photoCount).toBe(1);
    expect(store.insights(trip.id).people[0]).toMatchObject({ id: member.id, confirmedPhotos: 0, suggestedPhotos: 0 });
    store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user', members: [{ memberId: member.id, status: 'confirmed' }] }] });
    store.close(); store = openTripStudio(path, () => photos);
    cleanup.push(() => store.close());
    expect(store.list()[0].members[0]).toEqual(member);
    expect(store.details(trip.id).photos).toHaveLength(1);
    expect(store.details(trip.id).photos[0].annotation).toMatchObject({ revision: 1, schemaVersion: 1, provenance: 'user' });
    expect(store.insights(trip.id).people[0].confirmedPhotos).toBe(1);
  });

  it('attaches idempotently and scopes annotations, members and exports to their trip', async () => {
    const store = await setup();
    const first = store.create({ title: 'First', photoIds: [ids[0]], members: [{ name: 'Mark' }] });
    const second = store.create({ title: 'Second', photoIds: [ids[0], ids[1]], members: [{ name: 'Mark' }] });
    expect(store.attach(first.id, { photoIds: [ids[0], ids[1], ids[1]] }).added).toBe(1);
    const revision = store.details(first.id).trip.revision;
    expect(store.attach(first.id, { photoIds: [ids[1]] })).toMatchObject({ added: 0, trip: { revision } });
    expect(() => store.annotate(first.id, { annotations: [{ photoId: ids[0], provenance: 'user', members: [{ memberId: second.members[0].id, status: 'confirmed' }] }] })).toThrow(/people from this trip/);
    expect(() => store.annotate(first.id, { annotations: [{ photoId: ids[2], provenance: 'user' }] })).toThrow(/photos in this trip/);
    store.annotate(first.id, { annotations: [{ photoId: ids[0], provenance: 'user', aesthetic: 80 }] });
    expect(store.details(second.id).photos[0].annotation).toBeNull();
    expect(() => store.exportSelection(first.id, { photoIds: [ids[2]] })).toThrow(/from this trip/);
    expect(() => store.shortlist(first.id, { confirmedPerson: second.members[0].id })).toThrow(/from this trip/);
  });

  it('validates whole annotation batches before writing and rejects stale edits', async () => {
    const store = await setup(), trip = store.create({ title: 'Trip', photoIds: ids.slice(0, 2) });
    expect(() => store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user' }, { photoId: ids[2], provenance: 'user' }] })).toThrow();
    expect(store.details(trip.id).coverage.annotatedPhotos).toBe(0);
    const first = store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user', aesthetic: 80 }] });
    expect(first.annotations[0].revision).toBe(1);
    expect(() => store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user', aesthetic: 90 }] })).toThrow(/updated/);
    expect(store.details(trip.id).photos[0].annotation?.aesthetic).toBe(80);
    expect(store.annotate(trip.id, { annotations: [{ photoId: ids[0], revision: 1, provenance: 'user', aesthetic: 90 }] }).annotations[0].revision).toBe(2);
    expect(() => store.annotate(trip.id, { annotations: [{ photoId: ids[1], provenance: 'user' }, { photoId: ids[1], provenance: 'user' }] })).toThrow(/each photo only once/);
  });

  it('blocks a competing writer throughout validation and releases the lock after each mutation', async () => {
    const path = await directory(), attempts: string[] = [];
    let competing: DatabaseSync | undefined, probe = false;
    const store = openTripStudio(path, () => {
      if (probe) {
        // A second server tries to write while the first validates library state.
        // No threads or timing assumptions: SQLite must already hold its write lock.
        try { competing!.exec('BEGIN IMMEDIATE'); competing!.exec('ROLLBACK'); attempts.push('unlocked'); }
        catch (error) { attempts.push((error as Error).message); }
      }
      return photos;
    });
    competing = new DatabaseSync(join(path, '.trip-studio.sqlite'));
    competing.exec('PRAGMA busy_timeout=0');
    cleanup.push(() => store.close(), () => competing!.close());
    probe = true;
    const trip = store.create({ title: 'Trip', photoIds: [ids[0]] });
    store.attach(trip.id, { photoIds: [ids[1]] });
    const { member } = store.addMember(trip.id, { name: 'Mark', referencePhotoIds: [ids[0]] });
    store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user', members: [{ memberId: member.id, status: 'confirmed' }] }] });
    probe = false;
    expect(attempts).toHaveLength(4);
    expect(attempts.every(message => /locked/.test(message))).toBe(true);
    expect(store.details(trip.id).trip).toMatchObject({ revision: 4, photoCount: 2 });
    // The completed write does not keep the database locked against another server.
    competing.exec('BEGIN IMMEDIATE'); competing.exec('ROLLBACK');
  });

  it('keeps human identity confirmations distinct from model suggestions and protects corrections', async () => {
    const store = await setup(), trip = store.create({ title: 'Trip', photoIds: ids, members: [{ name: 'Mark' }] });
    const memberId = trip.members[0].id;
    const model = { photoId: ids[0], provenance: 'model', model: 'vision-test', evidence: 'Visible face compared with a reference.' };
    expect(() => store.annotate(trip.id, { annotations: [{ ...model, members: [{ memberId, status: 'confirmed' }] }] })).toThrow(/confirmed by the user/);
    expect(() => store.annotate(trip.id, { annotations: [{ ...model, evidence: '' }] })).toThrow(/evidence/);
    store.annotate(trip.id, { annotations: [{ ...model, members: [{ memberId, status: 'suggested' }] }] });
    expect(store.insights(trip.id).people[0]).toMatchObject({ confirmedPhotos: 0, suggestedPhotos: 1 });
    expect(store.shortlist(trip.id, { confirmedPerson: memberId }).matching).toBe(0);
    expect(() => store.exportSelection(trip.id, { photoIds: [ids[0]], confirmedPerson: memberId })).toThrow(/Confirm/);
    store.annotate(trip.id, { annotations: [{ photoId: ids[0], revision: 1, provenance: 'user', members: [{ memberId, status: 'confirmed' }] }] });
    expect(() => store.annotate(trip.id, { annotations: [{ ...model, revision: 2 }] })).toThrow(/cannot overwrite/);
    expect(store.exportSelection(trip.id, { photoIds: [ids[0]], confirmedPerson: memberId })).toMatchObject({ delivery: 'not-sent', recipient: { id: memberId } });
  });

  it('reports coverage and unique photo counts instead of fabricated analysis for the rest of the album', async () => {
    const store = await setup(), trip = store.create({ title: 'Trip', photoIds: ids, members: [{ name: 'Mark' }] });
    const memberId = trip.members[0].id;
    store.annotate(trip.id, { annotations: [
      { photoId: ids[0], provenance: 'user', activities: ['Walk', 'walk'], vibes: ['Sunny', 'sunny'], scene: 'people', smilesVisible: true, facesClear: false, aesthetic: 80, members: [{ memberId, status: 'confirmed' }] },
      { photoId: ids[1], provenance: 'model', model: 'vision-test', evidence: 'A seated group.', activities: ['walk'], scene: 'people', facesClear: true, members: [{ memberId, status: 'suggested' }] },
    ] });
    const insights = store.insights(trip.id);
    expect(insights.coverage).toMatchObject({ totalPhotos: 4, availablePhotos: 4, annotatedPhotos: 2, unannotatedPhotos: 2, userAnnotatedPhotos: 1, modelAnnotatedPhotos: 1, aestheticPhotos: 1, facesAssessedPhotos: 2, smilesAssessedPhotos: 1, locationPhotos: 1 });
    expect(insights.activities).toEqual([{ name: 'walk', count: 2 }]);
    expect(insights.vibes).toEqual([{ name: 'sunny', count: 1 }]);
    expect(insights.people[0]).toMatchObject({ confirmedPhotos: 1, suggestedPhotos: 1, uncertainPhotos: 0 });
    expect(insights.smilesVisiblePhotos).toBe(1);
    expect(insights.facesClearPhotos).toBe(1);
    expect(insights.locations).toEqual([{ lat: 35.68, lon: 139.76, photoIds: [ids[0]] }]);
  });

  it('requires every selected filter, ranks only observed criteria and uses stable tie breaks', async () => {
    const store = await setup(), trip = store.create({ title: 'Trip', photoIds: [...ids].reverse() });
    store.annotate(trip.id, { annotations: [
      { photoId: ids[0], provenance: 'user', aesthetic: 90, scene: 'people', activities: ['hike', 'swim'], vibes: ['sunny'], smilesVisible: true, facesClear: false },
      { photoId: ids[1], provenance: 'user', aesthetic: 90, scene: 'people', activities: ['hike'], smilesVisible: true, facesClear: true },
      { photoId: ids[2], provenance: 'user', aesthetic: 0, scene: 'scenery', activities: ['swim'], facesClear: null },
    ] });
    expect(store.shortlist(trip.id, { rank: 'aesthetic' }).photos.map(photo => photo.id)).toEqual(ids.slice(0, 3));
    expect(store.shortlist(trip.id, { rank: 'faces' }).photos.map(photo => photo.id)).toEqual([ids[1], ids[0]]);
    expect(store.shortlist(trip.id, { activities: ['HIKE', 'swim'], vibes: ['sunny'], smilesVisible: true }).photos.map(photo => photo.id)).toEqual([ids[0]]);
    expect(store.shortlist(trip.id, { smilesVisible: false }).matching).toBe(0);
    expect(store.shortlist(trip.id, { rank: 'aesthetic', limit: 1 })).toMatchObject({ matching: 3, total: 4 });
    expect(store.shortlist(trip.id, {}).matching).toBe(4);
  });

  it('counts unavailable photos separately and never exports stale file references', async () => {
    let available = photos;
    const store = openTripStudio(await directory(), () => available);
    cleanup.push(() => store.close());
    const trip = store.create({ title: 'Trip', photoIds: ids });
    store.annotate(trip.id, { annotations: [{ photoId: ids[0], provenance: 'user', aesthetic: 99 }] });
    available = photos.slice(1);
    expect(store.insights(trip.id).coverage).toMatchObject({ totalPhotos: 4, availablePhotos: 3, unavailablePhotos: 1, annotatedPhotos: 0, unannotatedPhotos: 3, aestheticPhotos: 0 });
    expect(() => store.exportSelection(trip.id, { photoIds: [ids[0]] })).toThrow(/available photos/);
    expect(() => store.annotate(trip.id, { annotations: [{ photoId: ids[0], revision: 1, provenance: 'user' }] })).toThrow(/available photos/);
  });

  it('validates dates and fields, rejects unknown photos and keeps distinct people with the same name', async () => {
    const store = await setup();
    expect(() => store.create({ title: 'Trip', startDate: '2026-02-30' })).toThrow();
    expect(() => store.create({ title: 'Trip', startDate: '2026-07-03', endDate: '2026-07-01' })).toThrow();
    expect(() => store.create({ title: 'Trip', path: '/private' })).toThrow();
    expect(() => store.create({ title: 'Trip', photoIds: ['f'.repeat(64)] })).toThrow(/current library/);
    const trip = store.create({ title: 'Trip', photoIds: [ids[0]], members: [{ name: 'Mark', qualifier: 'college' }] });
    expect(() => store.addMember(trip.id, { name: 'Mark', referencePhotoIds: [ids[1]] })).toThrow(/belong to this trip/);
    const member = store.addMember(trip.id, { name: 'Mark', qualifier: 'soccer', referencePhotoIds: [ids[0]] }).member;
    expect(member.id).not.toBe(trip.members[0].id);
    expect(store.details(trip.id).trip.members.map(person => person.qualifier)).toEqual(['college', 'soccer']);
  });

  it('exposes validated HTTP endpoints with meaningful missing and conflict responses', async () => {
    const app = Fastify();
    registerTripStudio(app, { datasetDir: await directory(), getPhotos: () => photos });
    cleanup.push(() => app.close());
    const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload });
    const root = '/api/studio/trips';
    expect((await post(root, { title: '' })).statusCode).toBe(400);
    expect((await app.inject({ url: `${root}/00000000-0000-4000-8000-000000000000` })).statusCode).toBe(404);
    const created = await post(root, { title: 'Trip', photoIds: [ids[0]] });
    expect(created.statusCode).toBe(200);
    const id = created.json().trip.id;
    expect((await app.inject({ url: root })).json().trips).toHaveLength(1);
    expect((await app.inject({ url: `${root}/${id}` })).json().coverage.totalPhotos).toBe(1);
    const annotation = { annotations: [{ photoId: ids[0], provenance: 'user', aesthetic: 80 }] };
    expect((await post(`${root}/${id}/annotations`, annotation)).statusCode).toBe(200);
    expect((await post(`${root}/${id}/annotations`, annotation)).statusCode).toBe(409);
    expect((await post(`${root}/${id}/shortlist`, { rank: 'aesthetic' })).json().photos).toHaveLength(1);
    expect((await app.inject({ url: `${root}/${id}/insights` })).json().coverage.annotatedPhotos).toBe(1);
  });

  it('inherits the workspace session and phone-token protections from the real server', async () => {
    const mobileToken = 'studio-test-token-'.repeat(4);
    const app = await createPlaygroundServer({ datasetDir: await directory(), mobileToken });
    cleanup.push(() => app.close());
    const url = '/api/studio/trips', payload = { title: 'Protected trip' };
    expect((await app.inject({ method: 'POST', url, headers: { host: 'localhost' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { host: '192.168.1.2' } })).statusCode).toBe(401);
    const root = await app.inject({ url: '/', headers: { host: 'localhost' } });
    const session = root.body.match(/name="playground-session" content="([^"]+)"/)![1];
    const headers = { host: 'localhost', 'x-playground-session': session };
    expect((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://another.example' }, payload })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(200);
    expect((await app.inject({ url, headers: { host: '192.168.1.2', authorization: `Bearer ${mobileToken}` } })).json().trips).toHaveLength(1);
  });
});
