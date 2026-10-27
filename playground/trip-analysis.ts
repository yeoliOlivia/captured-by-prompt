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
type Job = { id: string; tripId: string; photoIds: string[]; model: string; status: 'running'|'complete'|'failed'|'interrupted'; processed: number; cached: number; preservedUser?: number; skippedChanged?: number; ownerPid?: number; message: string; createdAt: string };

// Explicit, bounded paid work. Completed observations persist; restarting never retries billing.
export function registerStudioAnalysis(server: FastifyInstance, options: {
  datasetDir: string;
  store: ReturnType<typeof openTripStudio>;
  getProvider: () => { provider: Provider; model: string } | null;
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
    let data: ReturnType<typeof options.store.details>;
    try { data = options.store.details(id); } catch { return reply.code(404).send({ message: 'Trip not found.' }); }
    if (ids.some(photoId => !data.photos.some(photo => photo.id === photoId))) return reply.code(400).send({ message: 'Choose only photos from this trip.' });
    const connection = options.getProvider();
    if (!connection?.provider.observe) return reply.code(409).send({ message: 'Connect Gemini or Qwen in the photo workspace first.' });
    const model = `${connection.model}/${observationVersion}`;
    const photos = data.photos.filter(photo => ids.includes(photo.id));
    let preservedUser = photos.filter(photo => photo.annotation?.provenance === 'user').length;
    let pending = photos.filter(photo => photo.annotation?.provenance !== 'user' && photo.annotation?.model !== model);
    const job: Job = { id: input.requestId, tripId: id, photoIds: ids, model, status: 'running', processed: 0, cached: ids.length - pending.length - preservedUser, preservedUser, skippedChanged: 0, ownerPid: process.pid, message: '', createdAt: new Date().toISOString() };
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
      const existing = db.prepare("SELECT data FROM jobs WHERE json_extract(data,'$.status')='running'").all().map(row => JSON.parse(String(row.data)) as Job);
      if (existing.some(job => ownerAlive(job.ownerPid))) {
        db.exec('ROLLBACK');
        return reply.code(409).send({message:'Another server is analyzing this workspace. Wait for it to finish.'});
      }
      const currentPhotos = options.store.details(id).photos.filter(photo => ids.includes(photo.id));
      preservedUser = currentPhotos.filter(photo => photo.annotation?.provenance === 'user').length;
      pending = currentPhotos.filter(photo => photo.annotation?.provenance !== 'user' && photo.annotation?.model !== model);
      job.cached = ids.length - pending.length - preservedUser;
      job.preservedUser = preservedUser;
      save(job); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const run = async () => {
      try {
        if (pending.length) {
          const candidates = await Promise.all(pending.map(async photo => ({ id: photo.id, bytes: await readFile(resolve(options.datasetDir, `${photo.id}.jpg`)) })));
          const result = validateObservations(await connection.provider.observe!(candidates), candidates.map(photo => photo.id));
          for (const {id: photoId, ...observation} of result) {
            const before = pending.find(photo => photo.id === photoId)!;
            try {
              options.store.annotate(id, {annotations:[{
                ...observation, photoId, revision: before.annotation?.revision ?? 0,
                provenance:'model', model, members:before.annotation?.members ?? [],
              }]});
              job.processed++;
            } catch (error) {
              if ((error as {statusCode?:number}).statusCode !== 409) throw error;
              job.skippedChanged = (job.skippedChanged ?? 0) + 1;
            }
          }
        }
        job.status = 'complete';
        job.message = pending.length ? `${job.processed} photo observations saved. Scores are suggestions; identities were not inferred.` : job.cached ? 'Existing model analysis reused.' : 'No new analysis was run.';
        if (job.skippedChanged) job.message += ` ${job.skippedChanged} photo edits were preserved; their new model observations were not applied.`;
        if (preservedUser) job.message += ` ${preservedUser} user-edited photo${preservedUser === 1 ? ' was' : 's were'} kept unchanged and not analyzed; some attributes may remain unknown.`;
      } catch {
        job.status = 'failed'; job.message = 'Analysis could not be saved. Existing observations are intact. Check the connection or reload changed photos before explicitly retrying; the request may have been billed.';
      }
      save(job);
      return { job, coverage: options.store.details(id).coverage };
    };
    active = run();
    try { return await active; } finally { active = null; }
  });
  server.addHook('onClose', async () => { if (active) await active; db.close(); });
}
