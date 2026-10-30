// Scores trip-pooling results against the answer key written by scripts/build-face-test.py.
// Usage: npm run test:faces:score [-- vision-model]. See docs/trip-pooling-face-test.md.
// Reads sample-dataset/.context.sqlite read-only, so it is safe to run while the server is up.
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const datasetDir = resolve(process.env.CAPTURED_DATASET_DIR ?? resolve(root, 'sample-dataset'));
const key = JSON.parse(await readFile(resolve(root, 'artifacts/local/face-test/answer-key.json'), 'utf8')) as
  { members: Record<string, string>; photos: Record<string, { members: string[]; strangers: number }> };

const idByPath = new Map<string, string>();
for (const name of await readdir(datasetDir)) {
  if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
  const photo = JSON.parse(await readFile(resolve(datasetDir, name), 'utf8'));
  if (photo.source?.path) idByPath.set(photo.source.path, photo.id);
}

const db = new DatabaseSync(resolve(datasetDir, '.context.sqlite'), { readOnly: true });
const memories = db.prepare('SELECT data FROM memories').all().map(r => JSON.parse(String(r.data)));
const norm = (s: string) => s.trim().toLowerCase();
const people = new Map<string, any>();
for (const folder of Object.keys(key.members)) {
  const m = memories.find(m => m.kind === 'person' && [m.name, ...(m.aliases ?? [])].some((a: string) => norm(a) === folder));
  if (m) people.set(folder, m); else console.warn(`No person named "${folder}" in My context; skipping them.`);
}
const rows = db.prepare('SELECT photoId, memoryId, model, revision, status, evidence FROM photo_people').all() as any[];
const models = [...new Set(rows.map(r => r.model))];
const model = process.argv[2] ?? models[0];
if (!model) { console.error('No results yet. Click "Find people in trip photos" first.'); process.exit(1); }
if (models.length > 1 && !process.argv[2]) console.log(`Several models have results (${models.join(', ')}); scoring ${model}.`);
const tag = new Map(rows.filter(r => r.model === model).map(r => [`${r.photoId}:${r.memoryId}`, r]));

const counts = { tp: 0, fn: 0, fp: 0, tn: 0, uncertainTrue: 0, uncertainFalse: 0, missing: 0 };
const mistakes: string[] = [];
for (const [path, truth] of Object.entries(key.photos)) {
  const id = idByPath.get(path);
  if (!id) { counts.missing += people.size; mistakes.push(`${path}: not imported (click Reload photo folders)`); continue; }
  for (const [folder, m] of people) {
    const r = tag.get(`${id}:${m.id}`);
    const actual = truth.members.includes(folder);
    if (!r || r.revision !== m.revision) { counts.missing++; continue; }
    if (r.status === 'uncertain') { actual ? counts.uncertainTrue++ : counts.uncertainFalse++; continue; }
    const said = r.status === 'present';
    if (said && actual) counts.tp++;
    else if (!said && !actual) counts.tn++;
    else {
      said ? counts.fp++ : counts.fn++;
      mistakes.push(`${path}: ${said ? 'FALSE MATCH' : 'MISSED'} ${folder} (${truth.members.join(', ') || 'no members'}, ${truth.strangers} strangers) — "${r.evidence}"`);
    }
  }
}
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(0)}%` : 'n/a';
console.log(`Model: ${model}`);
console.log(`Precision (said present, was there): ${pct(counts.tp, counts.tp + counts.fp)}  (${counts.tp}/${counts.tp + counts.fp})`);
console.log(`Recall (was there, said present):    ${pct(counts.tp, counts.tp + counts.fn + counts.uncertainTrue)}  (${counts.tp}/${counts.tp + counts.fn + counts.uncertainTrue})`);
console.log(`Correct "absent": ${counts.tn}  ·  uncertain when present: ${counts.uncertainTrue}  ·  uncertain when absent: ${counts.uncertainFalse}  ·  not checked: ${counts.missing}`);
if (mistakes.length) console.log(`\nMistakes:\n${mistakes.join('\n')}`);
