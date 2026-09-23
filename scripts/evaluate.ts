import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { AnalysisSchema, PreparedQuerySchema, RankResponseSchema, HealthSchema, CONSENT_VERSION, EMBEDDING_MODEL, VISION_MODEL, retrieve, applyRanking, type Photo, type PreparedQuery, type RankResponse } from '@captured/core';

const checks = [
  { id: 'objects-colors', prompt: 'A red umbrella on the beach', history: [], expected: ['red-umbrella'] },
  { id: 'scene', prompt: 'The restaurant with green booths', history: [], expected: ['green-booths', 'green-booths-night'] },
  { id: 'refinement', prompt: 'Only the nighttime one', history: ['The restaurant with green booths'], expected: ['green-booths-night'] },
  { id: 'visible-text', prompt: 'The handwritten recipe with lemon', history: [], expected: ['lemon-recipe'] },
  { id: 'animal-location', prompt: 'The dog on the sofa', history: [], expected: ['dog-on-sofa'] },
  { id: 'color', prompt: 'A blue bicycle', history: [], expected: ['blue-bicycle'] },
  { id: 'landscape', prompt: 'A lake surrounded by mountains', history: [], expected: ['mountain-lake'] },
  { id: 'activity', prompt: 'The birthday cake with candles', history: [], expected: ['birthday-cake'] },
  { id: 'date', prompt: 'The beach in July 2026', history: [], expected: ['beach-july'] },
  { id: 'absent', prompt: 'A purple elephant riding a skateboard', history: [], expected: [] },
];
const output = resolve('artifacts/local');
await mkdir(output, { recursive: true });
const live = process.argv.includes('--live');
const manifestArg = process.argv.find(a => a.startsWith('--manifest='))?.slice('--manifest='.length);
if (!live) {
  const report = { status: 'not_run', reason: 'Live AI requires a free-tier account, a labeled 20–30 photo manifest, and explicit --live --consent flags. No model calls made.', checks: checks.map(c => ({ ...c, status: 'not_run' })) };
  await writeFile(resolve(output, 'evaluation.json'), JSON.stringify(report, null, 2));
  console.log(report.reason);
  console.log('Wrote artifacts/local/evaluation.json with all ten checks marked not_run.');
} else {
  if (!process.argv.includes('--consent')) throw new Error('Read README data handling, then pass --consent to send only the manifest photos and queries to free cloud AI.');
  if (!manifestArg) throw new Error('Pass --manifest=/absolute/path/to/evaluation.json');
  const token = process.env.DEV_TOKEN;
  if (!token || token.length < 32) throw new Error('Set DEV_TOKEN to the local backend token. Do not put provider keys in the command.');
  const base = process.env.API_URL ?? 'http://127.0.0.1:8787';
  async function call<T>(path: string, schema: z.ZodType<T>, data?: unknown): Promise<T> {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(100000) });
    if (!response.ok) throw new Error(`Evaluation stopped: ${response.status}. Check server free access or quota; no paid fallback will be used.`);
    return schema.parse(await response.json());
  }
  const health = await call('/health', HealthSchema);
  if (!health.geminiReady || health.mode !== 'free-only') throw new Error('Backend free-tier setup is not ready.');
  const manifestPath = resolve(manifestArg);
  const manifest = z.object({ photos: z.array(z.object({ id: z.string(), path: z.string(), capturedAt: z.iso.date().nullable() })).min(20).max(30) }).parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (new Set(manifest.photos.map(p => p.id)).size !== manifest.photos.length) throw new Error('Photo IDs must be unique.');
  for (const check of checks) for (const id of check.expected) if (!manifest.photos.some(p => p.id === id)) throw new Error(`Missing expected fixture ${id}. See docs/evaluation.example.json.`);
  const cacheDir = resolve(output, 'eval-cache'); await mkdir(cacheDir, { recursive: true });
  const digest = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
  const photos: Photo[] = [];
  const report: { status: string; completedPhotos: number; checks: Record<string, unknown>[]; error?: string } = { status: 'running', completedPhotos: 0, checks: [] };
  const saveReport = () => writeFile(resolve(output, 'evaluation.json'), JSON.stringify(report, null, 2));
  try {
    for (const p of manifest.photos) {
      const bytes = await readFile(resolve(dirname(manifestPath), p.path));
      const cacheFile = resolve(cacheDir, digest(Buffer.concat([Buffer.from(EMBEDDING_MODEL + VISION_MODEL), bytes])) + '.json');
      let analysis;
      try { analysis = AnalysisSchema.parse(JSON.parse(await readFile(cacheFile, 'utf8'))); } catch { /* No usable cache. */ }
      if (!analysis) {
        const preview = await sharp(bytes).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
        analysis = await call('/analyze', AnalysisSchema, { consentVersion: CONSENT_VERSION, imageBase64: preview.toString('base64') });
        await writeFile(cacheFile, JSON.stringify(analysis));
      }
      photos.push({ id: p.id, assetId: null, uri: p.path, width: 0, height: 0, capturedAt: p.capturedAt, status: 'ready', analysis, error: null, addedAt: '' });
      report.completedPhotos = photos.length; await saveReport();
    }
    for (const check of checks) {
      const start = performance.now();
      const request = { consentVersion: CONSENT_VERSION, prompt: check.prompt, history: check.history, today: '2026-09-22' };
      const queryFile = resolve(cacheDir, digest(EMBEDDING_MODEL + JSON.stringify(request)) + '.json');
      let prepared: PreparedQuery;
      try { prepared = PreparedQuerySchema.parse(JSON.parse(await readFile(queryFile, 'utf8'))); }
      catch { prepared = await call('/query', PreparedQuerySchema, request); await writeFile(queryFile, JSON.stringify(prepared)); }
      const baseline = retrieve(photos, prepared);
      let ranking: RankResponse = { mode: 'baseline', results: [] };
      if (health.jevReady) ranking = await call('/rank', RankResponseSchema, { consentVersion: CONSENT_VERSION, query: prepared.text, candidates: baseline.map(({ photo }) => ({ id: photo.id, description: photo.analysis!.description, visibleText: photo.analysis!.visibleText, capturedAt: photo.capturedAt })) });
      const ranked = applyRanking(baseline, ranking);
      report.checks.push({ ...check, baselineTop5: baseline.slice(0, 5).map(h => h.photo.id), top5: ranked.slice(0, 5).map(h => h.photo.id), mode: ranking.mode, hitAt5: check.expected.length ? ranked.slice(0, 5).some(h => check.expected.includes(h.photo.id)) : null, elapsedMs: Math.round(performance.now() - start), absentCaseNote: check.expected.length ? undefined : 'Nearest results are possibilities, not a claim that the absent target exists.' });
      await saveReport();
    }
    report.status = 'complete'; await saveReport();
    console.log('Wrote actual retrieval results to artifacts/local/evaluation.json. This small fixture set is not a full-library accuracy benchmark.');
  } catch (error) {
    report.status = 'paused'; report.error = error instanceof Error ? error.message : 'Evaluation interrupted'; await saveReport();
    console.error(report.error); process.exitCode = 1;
  }
}
