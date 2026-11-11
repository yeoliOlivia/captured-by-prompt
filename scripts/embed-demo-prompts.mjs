// Turns the demo's example searches (scripts/demo-prompts.json) into Gemini query embeddings, so the public demo can
// rank its photos for those searches without calling any model while people use it.
//
// Usage (from the repo root, after `node scripts/build-demo.mjs`):
//   node scripts/embed-demo-prompts.mjs
//
// The Gemini key is read from the GEMINI_API_KEY environment variable, or else from GEMINI_API_KEY= in apps/api/.env.
// It is used only for these requests and is never written anywhere. One embedding request per prompt (16 by default),
// on your Gemini quota. Writes demo/data/prompts.json and prints the top 3 photos per prompt as a quick sanity check.
import { GoogleGenAI } from '@google/genai';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'gemini-embedding-2';
const DIMENSIONS = 3072;

async function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const env = await readFile(join(root, 'apps/api/.env'), 'utf8');
    const line = env.split(/\r?\n/).find(l => /^\s*GEMINI_API_KEY\s*=/.test(l));
    const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    if (value) return value;
  } catch {}
  throw new Error('No Gemini key. Set GEMINI_API_KEY, or add GEMINI_API_KEY=... to apps/api/.env.');
}

function quantize(vector) {
  let max = 0;
  for (const v of vector) max = Math.max(max, Math.abs(v));
  const scale = max ? 127 / max : 0;
  return Int8Array.from(vector, v => Math.round(v * scale));
}
function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

const prompts = JSON.parse(await readFile(join(root, 'scripts/demo-prompts.json'), 'utf8'));
const client = new GoogleGenAI({ apiKey: await geminiKey() });
const state = JSON.parse(await readFile(join(root, 'demo/data/state.json'), 'utf8'));
const vectors = new Int8Array((await readFile(join(root, 'demo/data/embeddings.bin'))).buffer.slice(0));
const photo = i => vectors.subarray(i * DIMENSIONS, (i + 1) * DIMENSIONS);

const results = [];
for (const text of prompts) {
  const response = await client.models.embedContent({ model: MODEL, contents: text, config: { outputDimensionality: DIMENSIONS } });
  const values = response.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== DIMENSIONS) throw new Error(`Unexpected embedding for "${text}"`);
  const q = quantize(values);
  results.push({ text, embedding: Buffer.from(q.buffer).toString('base64') });
  const top = state.photos.map((p, i) => ({ name: p.name, score: cosine(q, photo(i)) })).sort((a, b) => b.score - a.score).slice(0, 3);
  console.log(`${text}\n  ${top.map(t => `${t.name} (${t.score.toFixed(3)})`).join(', ')}`);
}
await writeFile(join(root, 'demo/data/prompts.json'), JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, prompts: results }) + '\n');
console.log(`Wrote demo/data/prompts.json with ${results.length} example searches.`);
