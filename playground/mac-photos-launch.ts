import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const bundledApp = fileURLToPath(new URL('../artifacts/local/Afterglow Photos.app', import.meta.url));
const local = (request: FastifyRequest) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip)
  && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '');

export function registerMacPhotosLauncher(server: FastifyInstance, options: {
  platform?: NodeJS.Platform; appPath?: string; launch?: (path: string) => Promise<void>;
} = {}) {
  const platform = options.platform ?? process.platform;
  const appPath = options.appPath ?? bundledApp;
  const launch = options.launch ?? (async path => { await promisify(execFile)('/usr/bin/open', [path], {timeout:10000}); });
  const available = async () => platform === 'darwin' && await stat(resolve(appPath,'Contents/MacOS/AfterglowPhotos')).then(s=>s.isFile(),()=>false);
  server.get('/api/studio/mac/status', async (request, reply) => {
    if (!local(request)) return reply.code(403).send({message:'Open this workspace on the Mac that contains your Photos library.'});
    return {supported:platform === 'darwin',available:await available(),workspaceURL:'http://127.0.0.1:8790'};
  });
  server.post('/api/studio/mac/launch', async (request, reply) => {
    if (!local(request)) return reply.code(403).send({message:'Open Afterglow on the Mac that contains your Photos library.'});
    if (platform !== 'darwin') return reply.code(400).send({message:'Apple Photos import needs a Mac with its Photos library available.'});
    // The companion deliberately connects only to this fixed loopback address.
    if (!/^(127\.0\.0\.1|localhost):8790$/.test(request.headers.host ?? '')) return reply.code(409).send({message:'The Photos companion uses http://127.0.0.1:8790. Open that workspace before connecting an album.'});
    if (!await available()) return reply.code(503).send({message:'Build the Mac companion first: run npm run build:mac-photos in this repository, then try again.'});
    try { await launch(appPath); return {opened:true}; }
    catch { return reply.code(503).send({message:'The Photos companion could not open. Open artifacts/local/Afterglow Photos.app on this Mac, or rebuild it with npm run build:mac-photos.'}); }
  });
}
