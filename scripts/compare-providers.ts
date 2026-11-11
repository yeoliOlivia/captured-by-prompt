// Compares search quality, speed and rough cost across providers on a small labelled photo set.
//
//   GEMINI_API_KEY=… MODAL_INFERENCE_TOKEN=… MODAL_EMBED_URL=https://… \
//   node --import tsx scripts/compare-providers.ts --manifest=/abs/path/benchmark.json --providers=gemini,modal --consent [--verify]
//
// Keys come from the environment so they never appear in shell history arguments. Each provider indexes the same
// photos in a fresh temporary collection (your real collection is not touched). Results go to
// artifacts/local/provider-comparison.json. See docs/provider-benchmark.example.json for the manifest format.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createPlaygroundServer } from '../playground/server.js';
import { BenchmarkManifestSchema, mean, ndcgAt, recallAt, reciprocalRank, verdictAgreement } from '../playground/benchmark.js';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const manifestArg = arg('manifest');
const providers = (arg('providers') ?? 'gemini,modal').split(',').map(s => s.trim()).filter(Boolean);
const verify = process.argv.includes('--verify');
// Modal L4 GPU list price (modal.com/pricing, checked 2026-11-09) and the idle time before the container stops.
const L4_PER_SECOND = 0.000222, MODAL_IDLE_SECONDS = 300;

if (!manifestArg) throw new Error('Pass --manifest=/absolute/path/to/benchmark.json (see docs/provider-benchmark.example.json).');
if (!process.argv.includes('--consent')) throw new Error('This sends the manifest photos and queries to each listed provider (Google, Alibaba Beijing, or your Modal account). Pass --consent to proceed.');
for (const p of providers) if (!['gemini', 'qwen', 'modal'].includes(p)) throw new Error(`Unknown provider ${p}. Use gemini, qwen, modal.`);

const keys: Record<string, { key?: string; extra?: Record<string, string | undefined> }> = {
  gemini: { key: process.env.GEMINI_API_KEY },
  qwen: { key: process.env.QWEN_API_KEY },
  modal: { key: process.env.MODAL_INFERENCE_TOKEN, extra: { endpoint: process.env.MODAL_EMBED_URL, visionKey: verify ? process.env.GEMINI_API_KEY : undefined } },
};
for (const p of providers) if (!keys[p].key) throw new Error(`Set ${p === 'modal' ? 'MODAL_INFERENCE_TOKEN (and MODAL_EMBED_URL)' : p === 'qwen' ? 'QWEN_API_KEY' : 'GEMINI_API_KEY'} for ${p}.`);
if (providers.includes('modal') && verify && !process.env.GEMINI_API_KEY) throw new Error('--verify with modal uses Gemini for visual checks; set GEMINI_API_KEY.');

const manifestPath = resolve(manifestArg);
const manifest = BenchmarkManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const output = resolve('artifacts/local');
await mkdir(output, { recursive: true });
const report: Record<string, unknown> = { manifest: manifestPath, verify, startedAt: new Date().toISOString(), providers: {} };

for (const name of providers) {
  const datasetDir = await mkdtemp(join(tmpdir(), `captured-benchmark-${name}-`));
  const server = await createPlaygroundServer({ datasetDir });
  try {
    const session = (await server.inject({ url: '/', headers: { host: 'localhost' } })).body.match(/name="playground-session" content="([^"]+)"/)![1];
    const headers = { host: 'localhost', 'x-playground-session': session };
    const post = async (url: string, payload: unknown = {}) => {
      const response = await server.inject({ method: 'POST', url, headers, payload: payload as any });
      return { status: response.statusCode, body: response.json() };
    };
    const state = async () => (await server.inject({ url: '/state', headers })).json();
    // The server names photos by content hash; map those back to manifest IDs.
    const toManifestId = new Map<string, string>();
    for (const photo of manifest.photos) {
      const bytes = await readFile(resolve(dirname(manifestPath), photo.path));
      const response = await server.inject({ method: 'POST', url: '/upload', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: bytes });
      if (response.statusCode !== 200) throw new Error(`Upload of ${photo.id} failed: ${response.body}`);
      toManifestId.set(response.json().photo.id, photo.id);
    }
    const connected = await post('/connect', { key: keys[name].key, provider: name, ...keys[name].extra });
    if (connected.status !== 200) throw new Error(`${name}: ${connected.body.message}`);
    const indexStart = performance.now();
    await post('/index');
    for (let s = await state(); s.indexing; s = await state()) await new Promise(r => setTimeout(r, 200));
    const indexSeconds = (performance.now() - indexStart) / 1000;
    const after = await state();
    if (after.indexed !== manifest.photos.length) throw new Error(`${name}: indexed ${after.indexed} of ${manifest.photos.length}. ${after.error}`);

    type Row = { id: string; seconds: number; error?: string; query?: string; top5?: string[]; recall10?: number; rr?: number; ndcg10?: number; verdicts?: ReturnType<typeof verdictAgreement> };
    const rows: Row[] = [];
    let failures = 0;
    for (const q of manifest.queries) {
      const start = performance.now();
      const response = await post('/search', { query: q.query, verify });
      const seconds = (performance.now() - start) / 1000;
      if (response.status !== 200) { failures++; rows.push({ id: q.id, error: response.body.message, seconds }); continue; }
      const ranked: string[] = response.body.results.map((r: { id: string }) => toManifestId.get(r.id) ?? r.id);
      const verdicts = verify ? response.body.results.filter((r: any) => r.verification).map((r: any) => ({ id: toManifestId.get(r.id) ?? r.id, verdict: r.verification.verdict })) : [];
      rows.push({ id: q.id, query: q.query, top5: ranked.slice(0, 5), recall10: recallAt(ranked, q.relevant, 10), rr: reciprocalRank(ranked, q.relevant), ndcg10: ndcgAt(ranked, q.relevant, 10), seconds,
        ...(verify ? { verdicts: verdictAgreement(verdicts, q.relevant) } : {}) });
    }
    const ok = rows.filter(r => !r.error);
    const sum = (k: 'correct' | 'wrong' | 'uncertain') => ok.reduce((s, r) => s + (r.verdicts?.[k] ?? 0), 0);
    const totalSeconds = indexSeconds + rows.reduce((s, r) => s + r.seconds, 0);
    report.providers = { ...(report.providers as object), [name]: {
      model: after.model, dimensions: after.dimensions, indexSeconds, firstQuerySeconds: rows[0]?.seconds,
      medianQuerySeconds: rows.map(r => r.seconds).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
      recall10: mean(ok.map(r => r.recall10)), mrr: mean(ok.map(r => r.rr)), ndcg10: mean(ok.map(r => r.ndcg10)), failedQueries: failures,
      ...(verify ? { verify: { correct: sum('correct'), wrong: sum('wrong'), uncertain: sum('uncertain') } } : {}),
      // Upper-bound GPU estimate: wall-clock time of this run plus the idle period before Modal stops the container.
      ...(name === 'modal' ? { estimatedModalUsd: Number(((totalSeconds + MODAL_IDLE_SECONDS) * L4_PER_SECOND).toFixed(3)) } : {}),
      queries: rows,
    } };
  } finally {
    await server.close();
    await rm(datasetDir, { recursive: true, force: true });
  }
}
await writeFile(resolve(output, 'provider-comparison.json'), JSON.stringify(report, null, 2));
const fmt = (v: unknown) => typeof v === 'number' ? v.toFixed(3) : String(v ?? '-');
console.table(Object.fromEntries(Object.entries(report.providers as Record<string, any>).map(([n, r]) => [n, {
  'Recall@10': fmt(r.recall10), MRR: fmt(r.mrr), 'nDCG@10': fmt(r.ndcg10), 'index s': fmt(r.indexSeconds), 'first query s': fmt(r.firstQuerySeconds),
  'median query s': fmt(r.medianQuerySeconds), failed: r.failedQueries, ...(verify ? { 'verify right/wrong/unsure': `${r.verify.correct}/${r.verify.wrong}/${r.verify.uncertain}` } : {}),
}])));
console.log('Full results: artifacts/local/provider-comparison.json. A 20-30 photo set shows large differences only; it is not a full-library accuracy measurement.');
