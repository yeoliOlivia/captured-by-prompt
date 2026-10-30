import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { exifDateTime, parseExif } from './exif';
import { createPlaygroundServer } from './server';

// A JPEG with a capture time, time zone and exact GPS, as a phone camera writes it.
const photo = (color: string, when: string, gps = true) => sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
  .withExif({ IFD0: { Make: 'Test' }, IFD2: { DateTimeOriginal: when, OffsetTimeOriginal: '-07:00' },
    ...(gps ? { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 46/1 2988/100', GPSLongitudeRef: 'W', GPSLongitude: '122/1 25/1 1000/100' } } : {}) })
  .jpeg().toBuffer();

describe('capture metadata', () => {
  it('keeps local capture time and only a coarse location', async () => {
    const meta = parseExif((await sharp(await photo('#f00', '2026:07:04 18:30:05')).metadata()).exif);
    expect(meta).toEqual({ capturedAt: '2026-07-04T18:30:05-07:00', place: { lat: 37.77, lon: -122.42 } });
    expect(parseExif(undefined)).toEqual({ capturedAt: null, place: null });
    expect(parseExif(Buffer.from('Exif\0\0garbage-garbage'))).toEqual({ capturedAt: null, place: null });
    expect(exifDateTime('2026:02:30 10:00:00')).toBeNull();
    expect(exifDateTime('0000:00:00 00:00:00')).toBeNull();
    expect(exifDateTime('2026:02:03 10:00:00', 'junk')).toBe('2026-02-03T10:00:00');
  });
});

describe('trip photo pooling', () => {
  it('finds members in trip photos once, suggests photos from other phones, and exports without location', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'captured-trip-'));
    for (const folder of ['tahoe/alex', 'tahoe/sam', 'refs']) await mkdir(join(dir, folder), { recursive: true });
    await writeFile(join(dir, 'tahoe/alex/a1.jpg'), await photo('#f00', '2026:07:04 10:00:00'));
    await writeFile(join(dir, 'tahoe/alex/a2.jpg'), await photo('#0f0', '2026:07:05 12:00:00'));
    await writeFile(join(dir, 'tahoe/sam/s1.jpg'), await photo('#00f', '2026:07:05 13:00:00'));
    await writeFile(join(dir, 'tahoe/sam/before.jpg'), await photo('#ff0', '2026:06:30 09:00:00'));
    await writeFile(join(dir, 'refs/alex.jpg'), await photo('#0ff', '2025:01:01 09:00:00', false));
    await writeFile(join(dir, 'refs/sam.jpg'), await photo('#f0f', '2025:01:01 09:00:00', false));
    let identifyCalls = 0, lastPeople: string[] = [];
    const vec = Array.from({ length: 3072 }, (_, i) => i === 0 ? 1 : 0);
    const providerFactory = () => ({
      image: async () => vec, text: async () => vec,
      identify: async (photos: { id: string }[], people: { personId: string; references: Buffer[] }[]) => {
        identifyCalls++; lastPeople = people.map(p => p.personId);
        expect(people.every(p => p.references.length === 1)).toBe(true);
        // Everyone appears in every photo except one uncertain answer, so filtering is done by the server.
        return { results: photos.map((p, i) => ({ id: p.id, people: people.map(p2 => ({ personId: p2.personId, status: i === 0 && p2.personId === 'P2' ? 'uncertain' : 'present', evidence: 'face visible' })) })) };
      },
    });
    const server = await createPlaygroundServer({ datasetDir: dir, providerFactory });
    const token = (await server.inject({ url: '/', headers: { host: 'localhost' } })).body.match(/name="playground-session" content="([^"]+)"/)![1];
    const post = (url: string, payload: any = {}) => server.inject({ method: 'POST', url, headers: { host: 'localhost', 'x-playground-session': token }, payload });
    const state = async () => (await server.inject({ url: '/state', headers: { host: 'localhost' } })).json();
    const photos: any[] = (await state()).photos;
    const byName = (n: string) => photos.find(p => p.name === n);
    expect(byName('a1.jpg')).toMatchObject({ contributor: 'alex', capturedAt: '2026-07-04T10:00:00-07:00' });
    expect(byName('alex.jpg').contributor).toBeNull();
    const alex = (await post('/context/save', { kind: 'person', name: 'Alex', photoIds: [byName('alex.jpg').id] })).json().memory;
    const sam = (await post('/context/save', { kind: 'person', name: 'Sam', photoIds: [byName('sam.jpg').id] })).json().memory;
    expect((await post('/context/save', { kind: 'event', name: 'Tahoe', memberIds: [alex.id] })).statusCode).toBe(400);
    expect((await post('/context/save', { kind: 'person', name: 'Jo', memberIds: [alex.id], photoIds: [byName('sam.jpg').id] })).statusCode).toBe(400);
    const trip = (await post('/context/save', { kind: 'event', name: 'Tahoe', startDate: '2026-07-04', endDate: '2026-07-06', memberIds: [alex.id, sam.id] })).json().memory;

    expect((await post(`/trips/${trip.id}/tag`)).statusCode).toBe(503);
    await post('/connect', { key: 'test-only-key-never-real-123' });
    let summary = (await server.inject({ url: `/trips/${trip.id}`, headers: { host: 'localhost' } })).json();
    expect(summary).toMatchObject({ photos: 3, pending: 3 });
    expect(summary.contributors.sort()).toEqual(['alex', 'sam']);
    expect((await post(`/trips/${trip.id}/tag`)).json()).toMatchObject({ tagging: true, photos: 3, requests: 1 });
    while ((await state()).tagging) await new Promise(r => setTimeout(r, 5));
    expect(identifyCalls).toBe(1);
    expect(lastPeople).toEqual(['P1', 'P2']);

    summary = (await server.inject({ url: `/trips/${trip.id}`, headers: { host: 'localhost' } })).json();
    expect(summary.pending).toBe(0);
    const [forAlex, forSam] = summary.members;
    // Alex gets Sam's photo, not their own; Sam gets Alex's photos, one of them uncertain.
    expect(forAlex.suggested.map((p: any) => p.name)).toEqual(['s1.jpg']);
    expect(forSam.suggested.length + forSam.uncertain.length).toBe(2);
    expect(forSam.uncertain).toHaveLength(1);
    expect((await post(`/trips/${trip.id}/tag`)).json().tagging).toBe(false);

    // Editing one person's references re-checks the trip photos for them.
    await post('/context/save', { ...sam, photoIds: [byName('sam.jpg').id, byName('alex.jpg').id] });
    expect((await server.inject({ url: `/trips/${trip.id}`, headers: { host: 'localhost' } })).json().pending).toBe(3);
    // Deleting a member takes them off the trip; the trip itself and Alex's cached answers survive.
    const otherTrip = (await post('/context/save', { kind: 'event', name: 'Yosemite', startDate: '2026-08-01', endDate: '2026-08-02', memberIds: [sam.id] })).json().memory;
    expect((await post('/context/delete', { id: sam.id, revision: 2 })).json()).toEqual({ deleted: true, trips: ['Tahoe', 'Yosemite'] });
    const memories = (await server.inject({ url: '/context', headers: { host: 'localhost' } })).json().memories;
    expect(memories.map((m: any) => m.name).sort()).toEqual(['Alex', 'Tahoe', 'Yosemite']);
    expect(memories.find((m: any) => m.id === trip.id)).toMatchObject({ memberIds: [alex.id], revision: trip.revision + 1, startDate: '2026-07-04' });
    expect(memories.find((m: any) => m.id === otherTrip.id)).toMatchObject({ memberIds: [], revision: otherTrip.revision + 1 });
    summary = (await server.inject({ url: `/trips/${trip.id}`, headers: { host: 'localhost' } })).json();
    expect(summary.members.map((m: any) => m.name)).toEqual(['Alex']);
    expect(summary.pending).toBe(0);
    expect(summary.members[0].suggested.map((p: any) => p.name)).toEqual(['s1.jpg']);

    const exported = (await post(`/trips/${trip.id}/export`, { memberId: alex.id })).json();
    expect(exported).toMatchObject({ written: 1, originals: 1, copies: 0 });
    const files = await readdir(exported.folder);
    expect(files).toEqual([expect.stringMatching(/^2026-07-05-[a-f0-9]{12}\.jpg$/)]);
    const meta = await sharp(await readFile(join(exported.folder, files[0]))).metadata();
    expect(meta.width).toBe(64);
    expect(parseExif(meta.exif)).toEqual({ capturedAt: '2026-07-05T13:00:00', place: null });
    expect(exported.folder.startsWith(join(dir, '.exports'))).toBe(true);
    // Exports live in a hidden folder and are not imported back into the collection.
    expect((await post('/scan')).json().added).toBe(0);
    await server.close();

    // Records imported before metadata was kept are filled in from the unchanged original on the next scan.
    const recordPath = join(dir, `${byName('s1.jpg').id}.json`);
    const { capturedAt, place, contributor, metadataVersion, ...legacy } = JSON.parse(await readFile(recordPath, 'utf8'));
    await writeFile(recordPath, JSON.stringify(legacy));
    const restarted = await createPlaygroundServer({ datasetDir: dir, providerFactory });
    const backfilled = JSON.parse(await readFile(recordPath, 'utf8'));
    expect(backfilled).toMatchObject({ capturedAt: '2026-07-05T13:00:00-07:00', place: { lat: 37.77, lon: -122.42 }, contributor: 'sam', metadataVersion: 1 });
    await restarted.close();
  });
});
