import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Provider } from './providers.js';
import type { openTripStudio } from './trip-studio.js';
import { observationVersion, validateObservations } from './trip-observations.js';

const Input = z.object({ requestId: z.string().uuid(), photoIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(12) }).strict();
type Progress = {
  photoId: string;
  embedding: 'pending'|'cached'|'saved'|'unavailable';
  observation: 'pending'|'cached'|'preserved'|'saved'|'changed';
};
type Job = {
  id: string; tripId: string; photoIds: string[]; model: string;
  status: 'running'|'complete'|'failed'|'interrupted'; processed: number; cached: number;
  embedded?: number; embeddingCached?: number; embeddingModel?: string; dimensions?: number;
  phase?: 'embeddings'|'observations'|'finished'; currentPhotoId?: string; progress?: Progress[];
  errorCode?: 'auth'|'quota'|'model'|'output'|'storage'|'provider';
  preservedUser?: number; skippedChanged?: number; ownerPid?: number; message: string; createdAt: string;
};
type Connection = {
  provider: Provider; model: string;
  embeddingModel?: string; dimensions?: number;
  hasEmbedding?: (id: string) => boolean;
  saveEmbedding?: (id: string, values: number[]) => Promise<void>;
};

// Only report known categories. Provider errors can contain URLs, keys, or raw image data.
function failure(error: unknown, validatingOutput: boolean): { code: Job['errorCode']; message: string } {
  const status = Number((error as { status?: unknown; statusCode?: unknown } | null)?.status ?? (error as { statusCode?: unknown } | null)?.statusCode);
  if (status === 401 || status === 403) return { code:'auth', message:'The AI service rejected the API key or its access permissions. Check your connection.' };
  if (status === 429) return { code:'quota', message:'The AI service hit a rate limit or quota. Check your quota before retrying.' };
  if (status === 400 || status === 404) return { code:'model', message:'The AI service rejected this model or request. Check the configured model and access.' };
  if (validatingOutput || error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && error.message === 'Invalid embedding') return { code:'output', message:'The AI service returned invalid or incomplete output; it was not saved.' };
  if (['ENOENT','EACCES','EPERM','ENOSPC','EINVALIDCACHE'].includes(String((error as NodeJS.ErrnoException | null)?.code))) return { code:'storage', message:'A photo or its analysis could not be read or saved locally. Check your photo files and available storage.' };
  return { code:'provider', message:'Analysis could not finish. Check the AI connection before retrying.' };
}

// Explicit, bounded paid work. Completed observations persist; restarting never retries billing.
export function registerStudioAnalysis(server: FastifyInstance, options: {
  datasetDir: string;
  store: ReturnType<typeof openTripStudio>;
  getProvider: () => Connection | null;
  isBusy?: () => boolean;
}) {
  const path = resolve(options.datasetDir, '.trip-analysis.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
  const save = (job: Job) => db.prepare('INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id, JSON.stringify(job));
  const ownerAlive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
  for (const row of db.prepare('SELECT data FROM jobs').all()) {
    const job: Job = JSON.parse(String(row.data));
    if (job.status === 'running' && !ownerAlive(job.ownerPid)) save({ ...job, status: 'interrupted', message: 'Server stopped during analysis. Check saved coverage before explicitly retrying; the previous request may have been billed.' });
  }
  let active: Promise<unknown> | null = null;
  const liveJobs = () => db.prepare("SELECT data FROM jobs WHERE json_extract(data,'$.status')='running'").all().map(row => JSON.parse(String(row.data)) as Job).filter(job => ownerAlive(job.ownerPid));
  const base = '/api/studio/trips/:id';
  server.get(`${base}/analysis`, async (req, reply) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    try { options.store.details(id); } catch { return reply.code(404).send({ message: 'Trip not found.' }); }
    return { jobs: db.prepare('SELECT data FROM jobs ORDER BY rowid DESC').all().map(row => JSON.parse(String(row.data)) as Job).filter(job => job.tripId === id).slice(0, 30) };
  });
  server.post(`${base}/analyze`, async (req, reply) => {
    const input = Input.parse(req.body), id = z.string().uuid().parse((req.params as { id: string }).id);
    const ids = [...new Set(input.photoIds)].sort();
    const row = db.prepare('SELECT data FROM jobs WHERE id=?').get(input.requestId);
    if (row) {
      const existing: Job = JSON.parse(String(row.data));
      if (existing.tripId !== id || JSON.stringify(existing.photoIds) !== JSON.stringify(ids)) return reply.code(409).send({ message: 'This request ID belongs to a different selection.' });
      return { job: existing };
    }
    if (active) return reply.code(409).send({ message: 'Another trip analysis is running. Wait for it to finish.' });
    if (options.isBusy?.()) return reply.code(409).send({ message: 'Wait for the current workspace operation to finish.' });
    let data: ReturnType<typeof options.store.details>;
    try { data = options.store.details(id); } catch { return reply.code(404).send({ message: 'Trip not found.' }); }
    if (ids.some(photoId => !data.photos.some(photo => photo.id === photoId))) return reply.code(400).send({ message: 'Choose only photos from this trip.' });
    const connection = options.getProvider();
    if (!connection?.provider.observe) return reply.code(409).send({ message: 'Connect Gemini or Qwen in the photo workspace first.' });
    const embedding = connection.embeddingModel && connection.dimensions && connection.hasEmbedding && connection.saveEmbedding
      ? { model:connection.embeddingModel, dimensions:connection.dimensions, has:connection.hasEmbedding, save:connection.saveEmbedding }
      : null;
    if (!embedding && [connection.embeddingModel,connection.dimensions,connection.hasEmbedding,connection.saveEmbedding].some(value => value !== undefined)) {
      return reply.code(500).send({ message:'The search analysis connection is incomplete. Restart the workspace before analyzing photos.' });
    }
    const model = `${connection.model}/${observationVersion}`;
    const photos = data.photos.filter(photo => ids.includes(photo.id));
    let preservedUser = photos.filter(photo => photo.annotation?.provenance === 'user').length;
    let pending = photos.filter(photo => photo.annotation?.provenance !== 'user' && photo.annotation?.model !== model);
    const job: Job = {
      id: input.requestId, tripId: id, photoIds: ids, model, status: 'running', processed: 0,
      cached: ids.length - pending.length - preservedUser, preservedUser, skippedChanged: 0,
      embedded:0, embeddingCached:0, embeddingModel:embedding?.model, dimensions:embedding?.dimensions,
      phase:embedding ? 'embeddings' : 'observations', progress:[],
      ownerPid: process.pid, message: 'Preparing photo analysis.', createdAt: new Date().toISOString(),
    };
    // SQLite serializes the reservation across multiple servers for this workspace.
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = db.prepare('SELECT data FROM jobs WHERE id=?').get(input.requestId);
      if (prior) {
        const existingJob: Job = JSON.parse(String(prior.data));
        db.exec('ROLLBACK');
        if (existingJob.tripId !== id || JSON.stringify(existingJob.photoIds) !== JSON.stringify(ids)) return reply.code(409).send({message:'This request ID belongs to a different selection.'});
        return {job:existingJob};
      }
      if (liveJobs().length) {
        db.exec('ROLLBACK');
        return reply.code(409).send({message:'Another server is analyzing this workspace. Wait for it to finish.'});
      }
      const currentPhotos = options.store.details(id).photos.filter(photo => ids.includes(photo.id));
      preservedUser = currentPhotos.filter(photo => photo.annotation?.provenance === 'user').length;
      pending = currentPhotos.filter(photo => photo.annotation?.provenance !== 'user' && photo.annotation?.model !== model);
      job.cached = ids.length - pending.length - preservedUser;
      job.preservedUser = preservedUser;
      job.progress = currentPhotos.map(photo => ({
        photoId:photo.id,
        embedding:embedding ? embedding.has(photo.id) ? 'cached' : 'pending' : 'unavailable',
        observation:photo.annotation?.provenance === 'user' ? 'preserved' : photo.annotation?.model === model ? 'cached' : 'pending',
      }));
      job.embeddingCached = job.progress.filter(photo => photo.embedding === 'cached').length;
      save(job); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const run = async () => {
      let validatingOutput = false;
      try {
        // Persist each image vector before starting the scene-model batch. A failed
        // scene request or restart must never discard successful search analysis.
        if (embedding) for (const photo of job.progress!) {
          if (photo.embedding === 'cached') continue;
          job.currentPhotoId = photo.photoId;
          job.message = `Preparing search for photo ${(job.embedded ?? 0) + (job.embeddingCached ?? 0) + 1} of ${ids.length}.`;
          save(job);
          // Another writer may have completed the vector since reservation.
          if (embedding.has(photo.photoId)) {
            photo.embedding = 'cached'; job.embeddingCached = (job.embeddingCached ?? 0) + 1;
          } else {
            const bytes = await readFile(resolve(options.datasetDir, `${photo.photoId}.jpg`));
            const values = await connection.provider.image(bytes);
            await embedding.save(photo.photoId, values);
            photo.embedding = 'saved'; job.embedded = (job.embedded ?? 0) + 1;
          }
          save(job);
        }
        delete job.currentPhotoId;
        job.phase = 'observations';
        // Re-read annotations after embeddings: users can correct photos while
        // a provider request is in flight, and those edits remain authoritative.
        const currentPhotos = options.store.details(id).photos.filter(photo => ids.includes(photo.id));
        pending = currentPhotos.filter(photo => photo.annotation?.provenance !== 'user' && photo.annotation?.model !== model);
        preservedUser = currentPhotos.filter(photo => photo.annotation?.provenance === 'user').length;
        job.preservedUser = preservedUser;
        job.cached = currentPhotos.length - pending.length - preservedUser;
        for (const photo of job.progress!) {
          const annotation = currentPhotos.find(current => current.id === photo.photoId)?.annotation;
          photo.observation = annotation?.provenance === 'user' ? 'preserved' : annotation?.model === model ? 'cached' : 'pending';
        }
        job.message = pending.length ? `Reviewing ${pending.length} photos for activities, styles, and composition.` : 'Reusing saved observations.';
        save(job);
        if (pending.length) {
          const candidates = await Promise.all(pending.map(async photo => ({ id: photo.id, bytes: await readFile(resolve(options.datasetDir, `${photo.id}.jpg`)) })));
          const output = await connection.provider.observe!(candidates);
          validatingOutput = true;
          const result = validateObservations(output, candidates.map(photo => photo.id));
          validatingOutput = false;
          for (const {id: photoId, ...observation} of result) {
            const before = pending.find(photo => photo.id === photoId)!;
            try {
              options.store.annotate(id, {annotations:[{
                ...observation, photoId, revision: before.annotation?.revision ?? 0,
                provenance:'model', model, members:before.annotation?.members ?? [],
              }]});
              job.processed++;
              job.progress!.find(photo => photo.photoId === photoId)!.observation = 'saved';
            } catch (error) {
              if ((error as {statusCode?:number}).statusCode !== 409) throw error;
              job.skippedChanged = (job.skippedChanged ?? 0) + 1;
              job.progress!.find(photo => photo.photoId === photoId)!.observation = 'changed';
            }
            save(job);
          }
        }
        job.status = 'complete';
        job.phase = 'finished';
        job.message = embedding ? `${job.embedded} new search embeddings saved; ${job.embeddingCached} reused. ` : '';
        job.message += pending.length ? `${job.processed} photo observations saved. Scores are suggestions; identities were not inferred.` : job.cached ? 'Existing model observations reused.' : 'No new scene observations were run.';
        if (job.skippedChanged) job.message += ` ${job.skippedChanged} photo edits were preserved; their new model observations were not applied.`;
        if (preservedUser) job.message += ` ${preservedUser} user-edited photo${preservedUser === 1 ? ' was' : 's were'} kept unchanged; some scene attributes may remain unknown.`;
      } catch (error) {
        const problem = failure(error, validatingOutput);
        job.status = 'failed'; job.errorCode = problem.code;
        job.message = `${problem.message} ${job.embedded ?? 0} new search embeddings and ${job.processed} observations were saved and remain cached; existing analysis and user edits are intact. Explicitly retry only when ready; the failed request may have been billed.`;
      }
      save(job);
      return { job, coverage: options.store.details(id).coverage };
    };
    active = run();
    try { return await active; } finally { active = null; }
  });
  server.addHook('onClose', async () => { if (active) await active; db.close(); });
  return { isRunning: () => Boolean(active) || liveJobs().length > 0 };
}
