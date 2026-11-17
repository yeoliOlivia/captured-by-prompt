// Adds three example trips to YOUR local workspace so map mode, trip stats and groupings have something to show.
// Nothing here ships as a default: photos go to the git-ignored sample-dataset, and people and trips are saved
// through the running server like anything you add by hand. Who is in each photo is written from this script's
// own answer key, so no model key and no model calls are needed.
//
// Usage: start the app (npm run dev:web), then run npm run demo:trips. Safe to run again.
// Needs the LFW faces used by the face test in artifacts/local/lfw-download/lfw (see docs/trip-pooling-face-test.md).
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../playground/providers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const datasetDir = resolve(process.env.CAPTURED_DATASET_DIR ?? join(root, 'sample-dataset'));
const base = `http://127.0.0.1:${process.env.PORT ?? 8790}`;
const lfw = join(root, 'artifacts/local/lfw-download/lfw'), coco = join(root, 'sample-dataset/coco128');
const keyPath = join(root, 'artifacts/local/demo-trips/answer-key.json');

const PEOPLE: Record<string, string> = { Jen: 'Jennifer_Capriati', Andre: 'Andre_Agassi', Laura: 'Laura_Bush', Kofi: 'Kofi_Annan',
  Gloria: 'Gloria_Macapagal_Arroyo', Lleyton: 'Lleyton_Hewitt', Winona: 'Winona_Ryder', David: 'David_Beckham' };
const STRANGERS = ['Colin_Powell', 'Gerhard_Schroeder', 'Jacques_Chirac', 'Jean_Chretien', 'John_Ashcroft', 'Ariel_Sharon'];
const TRIPS = [
  { name: 'Lisbon', folder: 'demo-lisbon', start: '2026-05-14', members: ['Jen', 'Andre', 'Laura', 'Kofi'], spots: [[38.711, -9.13], [38.697, -9.206], [38.797, -9.39], [38.703, -9.178]] },
  { name: 'Kyoto', folder: 'demo-kyoto', start: '2026-03-27', members: ['Andre', 'Gloria', 'Lleyton'], spots: [[34.967, 135.773], [35.009, 135.667], [35.003, 135.775], [34.685, 135.805]] },
  { name: 'Banff', folder: 'demo-banff', start: '2026-08-08', members: ['Jen', 'Winona', 'David', 'Kofi', 'Gloria'], spots: [[51.417, -116.217], [51.178, -115.571], [51.322, -116.186], [51.089, -115.359]] },
];
const DAYS = 4, PEOPLE_SHOTS = 4, SCENERY_SHOTS = 2;

// A small seeded generator so the same trips are built every time.
let seed = 20261117;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = <T,>(items: T[], n: number) => [...items].map(v => [random(), v] as const).sort((a, b) => a[0] - b[0]).slice(0, n).map(v => v[1]);
const dms = (v: number) => { const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60); return `${d}/1 ${m}/1 ${Math.round(((a - d) * 60 - m) * 6000)}/100`; };
const day = (start: string, add: number) => new Date(Date.parse(`${start}T00:00:00Z`) + add * 86400000).toISOString().slice(0, 10);

type Key = { photos: Record<string, string[]>; refs: Record<string, string[]> };
async function build(): Promise<Key> {
  if (existsSync(keyPath) && TRIPS.every(t => existsSync(join(datasetDir, t.folder)))) return JSON.parse(await readFile(keyPath, 'utf8'));
  if (!existsSync(lfw)) throw new Error(`LFW faces not found at ${lfw}. Download them as described in docs/trip-pooling-face-test.md, then run this again.`);
  const pools: Record<string, string[]> = {};
  for (const name of [...Object.values(PEOPLE), ...STRANGERS]) pools[name] = pick((await readdir(join(lfw, name))).filter(f => f.endsWith('.jpg')).sort().map(f => join(lfw, name, f)), 1000);
  const face = (name: string) => { const file = pools[name].pop(); if (!file) throw new Error(`Not enough LFW photos of ${name}.`); return file; };
  const scenes = pick((await readdir(coco)).filter(f => f.endsWith('.jpg')).sort().map(f => join(coco, f)), 1000);
  const round = Buffer.from('<svg width="230" height="230"><rect width="230" height="230" rx="28" ry="28"/></svg>');
  const key: Key = { photos: {}, refs: {} };
  await mkdir(join(datasetDir, 'demo-refs'), { recursive: true });
  for (const [who, name] of Object.entries(PEOPLE)) {
    key.refs[who] = [];
    for (const i of [1, 2]) { const out = `demo-refs/${who.toLowerCase()}-ref${i}.jpg`; await writeFile(join(datasetDir, out), await readFile(face(name))); key.refs[who].push(out); }
  }
  let counter = 3000;
  for (const trip of TRIPS) for (const phone of trip.members) {
    await mkdir(join(datasetDir, trip.folder, phone.toLowerCase()), { recursive: true });
    // Some friends take more photos than others.
    const peopleShots = PEOPLE_SHOTS - 2 + Math.floor(random() * 5);
    for (let n = 0; n < peopleShots + SCENERY_SHOTS; n++) {
      const others = trip.members.filter(m => m !== phone);
      const present = n < peopleShots ? [...pick(others, 1 + Math.floor(random() * Math.min(3, others.length))), ...(random() < 0.25 ? [phone] : [])] : [];
      const shown = pick([...present.map(m => PEOPLE[m]), ...(present.length && random() < 0.3 ? pick(STRANGERS, 1) : [])], 9);
      const spot = trip.spots[Math.floor(random() * trip.spots.length)];
      const stamp = `${day(trip.start, n % DAYS).replace(/-/g, ':')} ${String(9 + n).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}:00`;
      const tiles = await Promise.all(shown.map(async (name, i) => ({ left: 512 - (shown.length * 250) / 2 + i * 250 + 10, top: 500,
        input: await sharp(face(name)).resize(230, 230).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer() })));
      const file = `${trip.folder}/${phone.toLowerCase()}/IMG_${counter++}.jpg`;
      await writeFile(join(datasetDir, file), await sharp(scenes.pop()!).resize(1024, 768, { fit: 'cover' }).composite(tiles)
        .withExif({ IFD0: { Make: 'Demo' }, IFD2: { DateTimeOriginal: stamp },
          IFD3: { GPSLatitudeRef: spot[0] < 0 ? 'S' : 'N', GPSLatitude: dms(spot[0]), GPSLongitudeRef: spot[1] < 0 ? 'W' : 'E', GPSLongitude: dms(spot[1]) } })
        .jpeg({ quality: 90 }).toBuffer());
      key.photos[file] = present;
    }
  }
  await mkdir(join(keyPath, '..'), { recursive: true });
  await writeFile(keyPath, JSON.stringify(key, null, 2));
  return key;
}

const key = await build();
const page = await fetch(base).catch(() => null);
if (!page?.ok) throw new Error(`The app is not running at ${base}. Start it with npm run dev:web, then run this again.`);
const session = (await page.text()).match(/name="playground-session" content="([^"]+)"/)![1];
async function post(path: string, body: unknown = {}) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-session': session }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.message}`);
  return data;
}
await post('/scan');
const state = await (await fetch(`${base}/state`)).json();
const idOf = (file: string) => {
  const folder = file.slice(0, file.lastIndexOf('/')), name = file.slice(file.lastIndexOf('/') + 1);
  const photo = state.photos.find((p: any) => p.folder === folder && p.name === name);
  if (!photo) throw new Error(`${file} was not imported. Check that the app uses ${datasetDir}.`);
  return photo.id as string;
};
let memories: any[] = (await (await fetch(`${base}/context`)).json()).memories;
const saved = (kind: string, name: string) => memories.find(m => m.kind === kind && m.name === name && m.qualifier === 'demo');
const people: Record<string, any> = {};
for (const who of Object.keys(PEOPLE)) people[who] = saved('person', who)
  ?? (await post('/context/save', { kind: 'person', name: who, qualifier: 'demo', notes: 'Example person added by npm run demo:trips.', photoIds: key.refs[who].map(idOf) })).memory;
const trips = [];
for (const t of TRIPS) trips.push(saved('event', t.name)
  ?? (await post('/context/save', { kind: 'event', name: t.name, qualifier: 'demo', notes: 'Example trip added by npm run demo:trips.', startDate: t.start, endDate: day(t.start, DAYS - 1), memberIds: t.members.map(m => people[m].id) })).memory);

// The answer key becomes the saved "who is in this photo" answers, for every vision model the app can select.
const db = new DatabaseSync(join(datasetDir, '.context.sqlite'));
const insert = db.prepare('INSERT INTO photo_people VALUES (?,?,?,?,?,?) ON CONFLICT(photoId,memoryId,model) DO UPDATE SET revision=excluded.revision, status=excluded.status, evidence=excluded.evidence');
memories = (await (await fetch(`${base}/context`)).json()).memories;
let labels = 0;
db.exec('BEGIN');
for (const t of TRIPS) for (const [file, present] of Object.entries(key.photos)) {
  if (!file.startsWith(`${t.folder}/`)) continue;
  for (const who of t.members) {
    const person = memories.find(m => m.id === people[who].id);
    for (const model of new Set(Object.values(CONFIG).map(c => c.vision))) insert.run(idOf(file), person.id, model, person.revision, present.includes(who) ? 'present' : 'absent', 'Labelled by the demo script.');
    labels++;
  }
}
db.exec('COMMIT'); db.close();
console.log(`Added ${trips.length} demo trips (${trips.map(t => t.name).join(', ')}), ${Object.keys(people).length} people and ${labels} labels. Open Trips or turn on Map.`);
