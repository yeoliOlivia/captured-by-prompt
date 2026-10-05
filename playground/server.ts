import Fastify from 'fastify';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const directory = fileURLToPath(new URL('.', import.meta.url));
const MODEL = 'gemini-embedding-2';
const DIMENSIONS = 768;
type Photo = { id: string; name: string; embedding?: number[]; model?: string };
type Provider = { image(bytes: Buffer): Promise<number[]>; text(query: string): Promise<number[]> };
function vector(values: unknown): number[] {
  const result = z.array(z.number().finite()).length(DIMENSIONS).parse(values);
  const norm = Math.hypot(...result);
  if (!norm) throw new Error('Invalid embedding');
  return result.map(v => v / norm);
}
export function geminiProvider(key: string): Provider {
  const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 45000, retryOptions: { attempts: 1 } } });
  const embed = async (contents: any) => vector((await client.models.embedContent({ model: MODEL, contents, config: { outputDimensionality: DIMENSIONS } })).embeddings?.[0]?.values);
  return { image: bytes => embed([{ inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') } }]), text: query => embed(query) };
}
function providerError(e: unknown) {
  const status = Number((e as any)?.status ?? (e as any)?.statusCode);
  if (status === 429) return 'Gemini quota reached. Your progress is saved; wait and try again.';
  if (status === 400 || status === 401 || status === 403) return 'Gemini rejected the request. Check your key and whether this project can use gemini-embedding-2.';
  return 'Gemini could not complete the request. Your photos and completed embeddings are saved. Try again.';
}
export async function createPlaygroundServer(options: { datasetDir?: string; providerFactory?: (key: string) => Provider } = {}) {
  const datasetDir = options.datasetDir ?? resolve(directory, '../sample-dataset');
  await mkdir(datasetDir, { recursive: true });
  const photos: Photo[] = [];
  for (const name of await readdir(datasetDir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const photo = JSON.parse(await readFile(resolve(datasetDir, name), 'utf8')) as Photo;
    if (photo.id !== name.slice(0, -5)) throw new Error('Invalid dataset record');
    await readFile(resolve(datasetDir, `${photo.id}.jpg`));
    if (photo.model !== MODEL) delete photo.embedding;
    if (photo.embedding) photo.embedding = vector(photo.embedding);
    photos.push(photo);
  }
  const save = async (photo: Photo) => {
    const path = resolve(datasetDir, `${photo.id}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify(photo));
    await rename(`${path}.tmp`, path);
  };
  // Plain photo folders can be copied into sample-dataset without index files.
  async function scanFolders() {
    let added = 0;
    const skipped: string[] = [];
    async function walk(folder: string) {
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const path = resolve(folder, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile() || !/\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
        // These are the app's generated image copies, not source photos.
        if (folder === datasetDir && /^[a-f0-9]{64}\.jpg$/.test(entry.name)) continue;
        if (photos.length >= 500) { skipped.push(entry.name); continue; }
        try {
          const bytes = await sharp(path, { limitInputPixels: 80_000_000 }).rotate()
            .resize(1024,1024,{fit:'inside',withoutEnlargement:true}).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
          const id = createHash('sha256').update(bytes).digest('hex');
          if (photos.some(p => p.id === id)) continue;
          const photo: Photo = { id, name: entry.name };
          await writeFile(resolve(datasetDir, `${id}.jpg`), bytes);
          await save(photo); photos.push(photo); added++;
        } catch { skipped.push(entry.name); }
      }
    }
    await walk(datasetDir);
    return { added, skipped };
  }
  const initialScan = await scanFolders();
  const server = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_, body, done) => done(null, body));
  const session = randomBytes(32).toString('hex');
  let provider: Provider | null = null;
  let task: Promise<void> | null = null;
  let searching = false, uploading = false, pause = false, scanning = false;
  let error = initialScan.skipped.length ? `Could not import ${initialScan.skipped.length} files (unsupported image or collection limit).` : '', current = '';
  let imageCalls = 0, queryCalls = 0;
  const queries = new Map<string, number[]>();
  const expose = (p: Photo) => ({ id: p.id, name: p.name, image: `/photos/${p.id}`, indexed: !!p.embedding });
  server.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return reply.code(403).send({ message: 'Open this page on localhost.' });
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.method === 'POST') {
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return reply.code(403).send({ message: 'Use the local page.' });
      const supplied = Buffer.from(String(request.headers['x-playground-session'] ?? ''));
      const expected = Buffer.from(session);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(403).send({ message: 'Reload the page and try again.' });
    }
  });
  server.setErrorHandler((e, _, reply) => reply.code((e as { statusCode?: number }).statusCode === 413 ? 413 : 400).send({ message: (e as { statusCode?: number }).statusCode === 413 ? 'Choose photos smaller than 25 MB each.' : 'Could not process that request. Check the input and try again.' }));
  server.get('/', async (_, reply) => reply.type('text/html').send((await readFile(resolve(directory, 'index.html'), 'utf8')).replace('__SESSION__', session)));
  server.get('/app.js', async (_, reply) => reply.type('text/javascript').send(await readFile(resolve(directory, 'app.js'), 'utf8')));
  server.get('/photos/:id', async (req, reply) => {
    const photo = photos.find(p => p.id === (req.params as any).id);
    if (!photo) return reply.code(404).send({ message: 'Photo not found.' });
    return reply.type('image/jpeg').send(await readFile(resolve(datasetDir, `${photo.id}.jpg`)));
  });
  server.get('/state', async () => ({ photos: photos.map(expose), datasetDir, configured: !!provider, indexing: !!task, searching, indexed: photos.filter(p => p.embedding).length, total: photos.length, current, error, imageCalls, queryCalls, model: MODEL }));
  server.post('/scan', async (_, reply) => {
    if (task || uploading || searching || scanning) return reply.code(409).send({ message: 'Wait for the current operation to finish.' });
    scanning = true;
    try { return await scanFolders(); } finally { scanning = false; }
  });
  server.post('/upload', async (req, reply) => {
    if (uploading || task || searching || scanning) return reply.code(409).send({ message: 'Wait for the current operation to finish.' });
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ message: 'Choose an image file.' });
    uploading = true;
    try {
      let bytes: Buffer;
      try { bytes = await sharp(req.body, { limitInputPixels: 80_000_000 }).rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer(); }
      catch { return reply.code(400).send({ message: 'This image could not be read. Try a JPEG, PNG, or WebP image.' }); }
      const id = createHash('sha256').update(bytes).digest('hex');
      const existing = photos.find(p => p.id === id);
      if (existing) return { photo: expose(existing), duplicate: true };
      if (photos.length >= 500) return reply.code(400).send({ message: 'This collection supports up to 500 photos.' });
      const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'Photo')).replace(/[\x00-\x1f]/g, '').slice(0,200) || 'Photo';
      const photo: Photo = { id, name };
      await writeFile(resolve(datasetDir, `${id}.jpg`), bytes);
      await save(photo); photos.push(photo);
      return { photo: expose(photo), duplicate: false };
    } finally { uploading = false; }
  });
  server.post('/connect', async (req, reply) => {
    if (task || searching) return reply.code(409).send({ message: 'Wait for Gemini to finish.' });
    const { key } = z.object({ key: z.string().trim().min(20).max(8192) }).parse(req.body);
    if (/\s/.test(key)) return reply.code(400).send({ message: 'Paste only the API key.' });
    provider = (options.providerFactory ?? geminiProvider)(key); error = '';
    return { configured: true };
  });
  server.post('/disconnect', async (_, reply) => {
    if (task || searching) return reply.code(409).send({ message: 'Pause indexing and wait for Gemini to finish.' });
    provider = null; queries.clear(); return { configured: false };
  });
  server.post('/index', async (_, reply) => {
    if (!provider) return reply.code(503).send({ message: 'Add your Gemini key first.' });
    if (searching || uploading || scanning) return reply.code(409).send({ message: 'Wait for the current operation to finish.' });
    if (task || photos.every(p => p.embedding)) return { indexing: !!task };
    error = ''; pause = false;
    task = (async () => {
      try {
        for (const p of photos.filter(p => !p.embedding)) {
          if (pause) break;
          current = p.name;
          const bytes = await readFile(resolve(datasetDir, `${p.id}.jpg`));
          imageCalls++;
          const embedding = vector(await provider!.image(bytes));
          await save({ ...p, embedding, model: MODEL });
          p.embedding = embedding; p.model = MODEL;
        }
      } catch (e) { error = providerError(e); }
      finally { current = ''; task = null; }
    })();
    return reply.code(202).send({ indexing: true });
  });
  server.post('/pause', async () => { pause = true; return { message: 'Pausing after the current photo.' }; });
  server.post('/search', async (req, reply) => {
    if (!provider) return reply.code(503).send({ message: 'Add your Gemini key first.' });
    if (task || searching) return reply.code(409).send({ message: 'Wait for the current Gemini request to finish.' });
    const { query } = z.object({ query: z.string().trim().min(1).max(1000) }).parse(req.body);
    const indexed = photos.filter(p => p.embedding);
    if (!indexed.length) return reply.code(400).send({ message: 'Analyze your photos first.' });
    searching = true;
    try {
      const cached = queries.has(query);
      let embedding = queries.get(query);
      if (!embedding) { queryCalls++; embedding = vector(await provider.text(query)); if (queries.size >= 100) queries.delete(queries.keys().next().value!); queries.set(query, embedding); }
      const results = indexed.map(p => ({ ...expose(p), similarity: p.embedding!.reduce((sum,v,i) => sum + v * embedding![i], 0) })).sort((a,b) => b.similarity-a.similarity);
      return { results, cached, model: MODEL };
    } catch (e) { return reply.code(502).send({ message: providerError(e) }); }
    finally { searching = false; }
  });
  server.addHook('onClose', async () => { pause = true; if (task) await task; provider = null; });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createPlaygroundServer();
  await server.listen({ host: '127.0.0.1', port: 8790 });
  console.log('Captured ready at http://127.0.0.1:8790');
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
