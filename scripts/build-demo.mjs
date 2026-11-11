// Builds the public demo's photo data in demo/ from the public sample photos that are already analyzed locally.
//
// Usage (from the repo root): node scripts/build-demo.mjs
//
// Only photos whose source is tracked by Git are included: the COCO128 set in sample-dataset/coco128/ and the six
// scikit-image samples checked in at sample-dataset/. Your own uploads, trip folders and face-test photos are never
// tracked, so they can never reach the demo. Records without a saved Gemini embedding are skipped (analyze them in the
// app first). No network access and no API key are needed.
//
// Writes:
//   demo/photos/<id>.jpg      the resized, EXIF-free copies the app already made
//   demo/data/state.json      photo list (id, display name, image path) for the page and the intro
//   demo/data/embeddings.bin  one int8 vector per photo, in state.json order (cosine similarity ignores the scale)
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = join(root, 'sample-dataset');
const out = join(root, 'demo');
const CACHE_KEY = 'gemini-embedding-2:3072';
const DIMENSIONS = 3072;

const tracked = new Set(execFileSync('git', ['ls-files', '-z', 'sample-dataset'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean));
const coco = new Set([...tracked].filter(p => p.startsWith('sample-dataset/coco128/') && p.endsWith('.jpg')).map(p => basename(p)));

function quantize(vector) {
  let max = 0;
  for (const v of vector) max = Math.max(max, Math.abs(v));
  const scale = max ? 127 / max : 0;
  return Int8Array.from(vector, v => Math.round(v * scale));
}

const photos = [];
for (const file of (await readdir(dataset)).filter(f => f.endsWith('.json')).sort()) {
  const record = JSON.parse(await readFile(join(dataset, file), 'utf8'));
  const embedding = record.embeddings?.[CACHE_KEY];
  if (!Array.isArray(embedding) || embedding.length !== DIMENSIONS) continue;
  const copy = file.replace(/\.json$/, '.jpg');
  const isPublic = coco.has(record.name) || tracked.has(`sample-dataset/${copy}`);
  if (!isPublic) continue;
  photos.push({ id: record.id.slice(0, 16), name: record.name, copy, embedding });
}
photos.sort((a, b) => a.name.localeCompare(b.name));
if (!photos.length) throw new Error('No analyzed public sample photos found. Run the app, analyze the bundled samples, then try again.');

await mkdir(join(out, 'photos'), { recursive: true });
await mkdir(join(out, 'data'), { recursive: true });
const vectors = new Int8Array(photos.length * DIMENSIONS);
for (const [i, photo] of photos.entries()) {
  await copyFile(join(dataset, photo.copy), join(out, 'photos', `${photo.id}.jpg`));
  vectors.set(quantize(photo.embedding), i * DIMENSIONS);
}
const state = {
  model: 'gemini-embedding-2', dimensions: DIMENSIONS, total: photos.length, indexed: photos.length,
  photos: photos.map(p => ({ id: p.id, name: p.name, image: `photos/${p.id}.jpg` })),
};
await writeFile(join(out, 'data', 'state.json'), JSON.stringify(state, null, 1) + '\n');
await writeFile(join(out, 'data', 'embeddings.bin'), vectors);
console.log(`Demo data: ${photos.length} public photos (${photos.filter(p => coco.has(p.name)).length} COCO128, ${photos.filter(p => !coco.has(p.name)).length} scikit-image).`);
