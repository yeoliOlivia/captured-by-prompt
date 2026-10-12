import Fastify from 'fastify';
import { CONFIG, geminiProvider, qwenProvider, vector, validateVerification, type Provider, type ProviderName } from './providers.js';
export { geminiProvider } from './providers.js';
import sharp from 'sharp';
import { openContext, PlanSchema, resolveContext, withSavedReferences, type Plan } from './context.js';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const directory = fileURLToPath(new URL('.', import.meta.url));
import { COLLECTION_LIMIT as PHOTO_LIMIT, PhotoScope } from '@captured/core/current';
type Photo = { id: string; name: string; embedding?: number[]; model?: string; embeddings?: Record<string,number[]>; source?: { path: string; size: number; mtimeMs: number } };
function providerError(e: unknown, step = '') {
  const status = Number((e as any)?.status ?? (e as any)?.statusCode);
  // Keys travel in headers, never in messages; this shows the provider's real reason in the terminal.
  console.error(`Provider error${step ? ` during ${step}` : ''}${Number.isFinite(status) ? ` (${status})` : ''}: ${String((e as Error)?.message ?? e).slice(0,500)}`);
  if (status === 429) return 'Provider quota reached. Your progress is saved; wait and try again.';
  if (status === 400 || status === 401 || status === 403) return 'Provider rejected the request. Check the API key, region, and model access.';
  return 'The model could not complete the request. Your photos and completed embeddings are saved. Try again.';
}
export async function createPlaygroundServer(options: { datasetDir?: string; mobileToken?: string; providerFactory?: (key: string, name: ProviderName) => Provider } = {}) {
  const datasetDir = options.datasetDir ?? resolve(directory, '../sample-dataset');
  await mkdir(datasetDir, { recursive: true });
  if (options.mobileToken && (options.mobileToken.length < 32 || /\s/.test(options.mobileToken))) throw new Error('Mobile access requires a token of at least 32 characters with no whitespace.');
  const identityFile = resolve(datasetDir, '.dataset-id');
  try { await writeFile(identityFile, randomUUID(), {flag:'wx', mode:0o600}); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const datasetId = z.string().uuid().parse((await readFile(identityFile,'utf8')).trim());
  const photos: Photo[] = [];
  let damagedRecords = 0, damagedEmbeddings = 0;
  let selected: ProviderName = 'gemini';
  const cacheKey = (name: ProviderName) => `${CONFIG[name].model}:${CONFIG[name].dimensions}`;
  const embeddingFor = (photo: Photo) => photo.embeddings?.[cacheKey(selected)];
  for (const name of await readdir(datasetDir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    let photo: Photo;
    try {
      photo = JSON.parse(await readFile(resolve(datasetDir, name), 'utf8')) as Photo;
      if (!photo || photo.id !== name.slice(0, -5) || typeof photo.name !== 'string') throw new Error('Invalid dataset record');
      if (!(await stat(resolve(datasetDir, `${photo.id}.jpg`))).isFile()) throw new Error('Missing photo');
    } catch { damagedRecords++; continue; }
    if (!photo.embeddings || typeof photo.embeddings !== 'object' || Array.isArray(photo.embeddings)) photo.embeddings = {};
    // Migrate legacy caches without discarding either provider's vectors.
    for (const name of Object.keys(CONFIG) as ProviderName[]) {
      const config = CONFIG[name];
      if (photo.model === config.model && photo.embedding?.length === config.dimensions && !photo.embeddings[cacheKey(name)]) photo.embeddings[cacheKey(name)] = photo.embedding;
      if (photo.embeddings[cacheKey(name)]) {
        try { photo.embeddings[cacheKey(name)] = vector(photo.embeddings[cacheKey(name)],config.dimensions); }
        catch { delete photo.embeddings[cacheKey(name)]; damagedEmbeddings++; }
      }
    }
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
    const sources = new Map(photos.filter(p => p.source).map(p => [p.source!.path, p.source!]));
    async function walk(folder: string) {
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue;
        const path = resolve(folder, entry.name);
        if (entry.isDirectory()) { await walk(path); continue; }
        if (!entry.isFile() || !/\.(jpe?g|png|webp)$/i.test(entry.name)) continue;
        // These are the app's generated image copies, not source photos.
        if (folder === datasetDir && /^[a-f0-9]{64}\.jpg$/.test(entry.name)) continue;
        if (photos.length >= PHOTO_LIMIT) { skipped.push(entry.name); continue; }
        try {
          const info = await stat(path);
          const source = { path: relative(datasetDir, path), size: info.size, mtimeMs: info.mtimeMs };
          const previous = sources.get(source.path);
          if (previous && previous.size === source.size && previous.mtimeMs === source.mtimeMs) continue;
          const bytes = await sharp(path, { limitInputPixels: 80_000_000 }).rotate()
            .resize(1024,1024,{fit:'inside',withoutEnlargement:true}).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
          const id = createHash('sha256').update(bytes).digest('hex');
          if (photos.some(p => p.id === id)) continue;
          const photo: Photo = { id, name: entry.name, source };
          await writeFile(resolve(datasetDir, `${id}.jpg`), bytes);
          await save(photo); photos.push(photo); added++;
        } catch { skipped.push(entry.name); }
      }
    }
    await walk(datasetDir);
    return { added, skipped };
  }
  const initialScan = await scanFolders();
  const contextStore = openContext(resolve(datasetDir,'.context.sqlite'));
  const contextVersion = () => createHash('sha256').update(JSON.stringify(contextStore.list())).digest('hex');
  const plans = new Map<string,Plan>();
  const resolvedQueries = new Map<string,string>();
  let contextCalls = 0;
  const server = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_, body, done) => done(null, body));
  const session = randomBytes(32).toString('hex');
  let provider: Provider | null = null;
  let task: Promise<void> | null = null;
  let searching = false, uploading = false, pause = false, scanning = false;
  const datasetWarnings = [
    ...(initialScan.skipped.length ? [`Could not import ${initialScan.skipped.length} files (unsupported image or collection limit).`] : []),
    ...(damagedRecords ? [`Skipped ${damagedRecords} damaged cache records or missing photos. Original files were kept; restore them from backup to recover these entries.`] : []),
    ...(damagedEmbeddings ? [`On startup, ${damagedEmbeddings} invalid embedding cache entries were marked for analysis again; valid saved embeddings were kept.`] : []),
  ].join(' ');
  let error = '', current = '';
  let imageCalls = 0, queryCalls = 0, verificationCalls = 0;
  const verifiedQueries = new Map<string, ReturnType<typeof validateVerification>>();
  const queries = new Map<string, number[]>();
  const expose = (p: Photo) => ({ id: p.id, name: p.name, image: `/photos/${p.id}`, indexed: !!embeddingFor(p) });
  server.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip);
    const suppliedToken = Buffer.from(String(request.headers.authorization ?? ''));
    const expectedToken = Buffer.from(`Bearer ${options.mobileToken ?? ''}`);
    const authenticated = !!options.mobileToken && suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken,expectedToken);
    if ((!local || request.headers.authorization) && !authenticated) return reply.code(401).send({message:'Connect using the workspace token in mobile Settings.'});
    if (authenticated && request.headers.origin && request.headers.origin !== `http://${host}`) return reply.code(403).send({message:'Cross-origin access is not allowed.'});
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.method === 'POST' && !authenticated) {
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return reply.code(403).send({ message: 'Use the local page.' });
      const supplied = Buffer.from(String(request.headers['x-playground-session'] ?? ''));
      const expected = Buffer.from(session);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(403).send({ message: 'Reload the page and try again.' });
    }
  });
  server.setErrorHandler((e, _, reply) => reply.code((e as { statusCode?: number }).statusCode === 413 ? 413 : 400).send({ message: (e as { statusCode?: number }).statusCode === 413 ? 'Choose photos smaller than 25 MB each.' : 'Could not process that request. Check the input and try again.' }));
  server.get('/', async (_, reply) => reply.type('text/html').send((await readFile(resolve(directory, 'index.html'), 'utf8')).replace('__SESSION__', session)));
  server.get('/app.js', async (_, reply) => reply.type('text/javascript').send(await readFile(resolve(directory, 'app.js'), 'utf8')));
  server.get('/search-utils.js', async (_, reply) => reply.type('text/javascript').send(await readFile(resolve(directory, '../packages/core/src/strictness.js'), 'utf8')));
  server.get('/context', async () => ({memories:contextStore.list()}));
  server.post('/context/save', async (req,reply) => {
    if (searching) return reply.code(409).send({message:'Wait for this search to finish.'});
    try { const memory = contextStore.save(req.body,new Set(photos.map(p=>p.id))); verifiedQueries.clear(); resolvedQueries.clear(); return {memory}; }
    catch(e) { return reply.code(400).send({message:e instanceof z.ZodError ? e.issues.map(i=>i.message).join(' ') : (e as Error).message}); }
  });
  server.post('/context/delete', async (req,reply) => {
    if (searching) return reply.code(409).send({message:'Wait for this search to finish.'});
    const {id,revision} = z.object({id:z.string().uuid(),revision:z.number().int().positive()}).parse(req.body);
    try { contextStore.remove(id,revision); verifiedQueries.clear(); resolvedQueries.clear(); return {deleted:true}; }
    catch(e) { return reply.code(409).send({message:(e as Error).message}); }
  });
  server.get('/photos/:id', async (req, reply) => {
    const photo = photos.find(p => p.id === (req.params as any).id);
    if (!photo) return reply.code(404).send({ message: 'Photo not found.' });
    return reply.type('image/jpeg').send(await readFile(resolve(datasetDir, `${photo.id}.jpg`)));
  });
  server.get('/state', async () => ({ protocol: 'captured-v2', datasetId, contextVersion: contextVersion(), photos: photos.map(expose), datasetDir, configured: !!provider, indexing: !!task, searching, indexed: photos.filter(p => embeddingFor(p)).length, total: photos.length, current, error: [datasetWarnings,error].filter(Boolean).join(' '), imageCalls, queryCalls, dimensions: CONFIG[selected].dimensions, model: CONFIG[selected].model, provider: selected, providerLabel: CONFIG[selected].label, verificationModel: CONFIG[selected].vision, verificationCalls, contextCalls }));
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
      if (photos.length >= PHOTO_LIMIT) return reply.code(400).send({ message: 'This collection supports up to 10,000 photos.' });
      const name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'Photo')).replace(/[\x00-\x1f]/g, '').slice(0,200) || 'Photo';
      const photo: Photo = { id, name };
      await writeFile(resolve(datasetDir, `${id}.jpg`), bytes);
      await save(photo); photos.push(photo);
      return { photo: expose(photo), duplicate: false };
    } finally { uploading = false; }
  });
  server.post('/connect', async (req, reply) => {
    if (task || searching) return reply.code(409).send({ message: 'Wait for the current model request to finish.' });
    const { key, provider: name } = z.object({ key: z.string().trim().min(20).max(8192), provider: z.enum(['gemini','qwen']).default('gemini') }).parse(req.body);
    if (/\s/.test(key)) return reply.code(400).send({ message: 'Paste only the API key.' });
    provider = options.providerFactory ? options.providerFactory(key,name) : name === 'qwen' ? qwenProvider(key) : geminiProvider(key); selected = name; plans.clear(); resolvedQueries.clear(); queries.clear(); verifiedQueries.clear(); error = '';
    return { configured: true };
  });
  server.post('/disconnect', async (_, reply) => {
    if (task || searching) return reply.code(409).send({ message: 'Pause indexing and wait for the current model request to finish.' });
    provider = null; plans.clear(); resolvedQueries.clear(); queries.clear(); verifiedQueries.clear(); return { configured: false };
  });
  server.post('/index', async (req, reply) => {
    if (!provider) return reply.code(503).send({ message: 'Add a provider API key first.' });
    if (searching || uploading || scanning) return reply.code(409).send({ message: 'Wait for the current operation to finish.' });
    const {photoIds} = z.object({photoIds:PhotoScope.optional()}).parse(req.body ?? {});
    const scope = photoIds ? new Set(photoIds) : null;
    const pending = photos.filter(p => (!scope || scope.has(p.id)) && !embeddingFor(p));
    if (task || !pending.length) return { indexing: !!task };
    error = ''; pause = false;
    task = (async () => {
      try {
        for (const p of pending) {
          if (pause) break;
          current = p.name;
          const bytes = await readFile(resolve(datasetDir, `${p.id}.jpg`));
          imageCalls++;
          const embedding = vector(await provider!.image(bytes), CONFIG[selected].dimensions);
          const embeddings = { ...p.embeddings, [cacheKey(selected)]: embedding };
          await save({ ...p, embeddings });
          p.embeddings = embeddings;
        }
      } catch (e) { error = providerError(e,'photo analysis'); }
      finally { current = ''; task = null; }
    })();
    return reply.code(202).send({ indexing: true });
  });
  server.post('/pause', async () => { pause = true; return { message: 'Pausing after the current photo.' }; });
  server.post('/search', async (req, reply) => {
    if (!provider) return reply.code(503).send({ message: 'Add a provider API key first.' });
    if (task || searching) return reply.code(409).send({ message: 'Wait for the current model request to finish.' });
    const { query, verify, context: useContext, bindings, photoIds } = z.object({ photoIds: PhotoScope.optional(), query: z.string().trim().min(1).max(1000), verify: z.boolean().default(false), context:z.boolean().default(false), bindings:z.record(z.string().max(100),z.string().uuid()).default({}) }).parse(req.body);
    const scope = photoIds ? new Set(photoIds) : null;
    const indexed = photos.filter(p => embeddingFor(p) && (!scope || scope.has(p.id)));
    if (!indexed.length) return reply.code(400).send({ message: 'Analyze your photos first.' });
    searching = true;
    let step = 'query interpretation';
    try {
      let plan:Plan = {visualQuery:query,references:[]};
      if (useContext) {
        if (!provider.plan) throw new Error('Context interpretation unavailable');
        const cachedPlan = plans.get(query);
        if (cachedPlan) plan = cachedPlan;
        else { contextCalls++; plan = PlanSchema.parse(await provider.plan(query)); if (plans.size >= 100) plans.delete(plans.keys().next().value!); plans.set(query,plan); }
      }
      const saved = contextStore.list();
      const resolution = resolveContext(useContext ? withSavedReferences(plan,query,saved) : plan,saved,bindings);
      if (resolution.questions.length) return {needsClarification:true,query,questions:resolution.questions};
      const memories = [...new Map(resolution.resolved.map(r=>[r.memory.id,r.memory])).values()];
      const contextUsed = resolution.resolved.map(r=>({term:r.term,id:r.memory.id,name:r.memory.name,qualifier:r.memory.qualifier}));
      let embeddingQuery = query;
      if (memories.length) {
        const resolutionKey = JSON.stringify([query,memories]);
        const prepared = resolvedQueries.get(resolutionKey);
        if (prepared) embeddingQuery = prepared;
        else {
          step = 'query enrichment'; contextCalls++;
          embeddingQuery = PlanSchema.parse(await provider.plan!(query,{entities:memories,bindings:contextUsed})).visualQuery;
          if (resolvedQueries.size >= 100) resolvedQueries.delete(resolvedQueries.keys().next().value!);
          resolvedQueries.set(resolutionKey,embeddingQuery);
        }
      }
      const cached = queries.has(embeddingQuery);
      let embedding = queries.get(embeddingQuery);
      step = 'query embedding';
      if (!embedding) { queryCalls++; embedding = vector(await provider.text(embeddingQuery),CONFIG[selected].dimensions); if (queries.size >= 100) queries.delete(queries.keys().next().value!); queries.set(embeddingQuery, embedding); }
      const results = indexed.map(p => ({ ...expose(p), similarity: embeddingFor(p)!.reduce((sum,v,i) => sum + v * embedding![i], 0) })).sort((a,b) => b.similarity-a.similarity);
      if (!verify && !memories.length) return { results, cached, model: CONFIG[selected].model, verified: false, contextUsed };
      if (!provider.verify) throw new Error('Verification unavailable');
      // Combine visual-query retrieval with reference-image retrieval. References broaden
      // the shortlist, but never establish a match: the original query is checked below.
      const indexedById = new Map(indexed.map(p=>[p.id,p]));
      const linked = new Set(memories.flatMap(m=>m.photoIds));
      const referencePhotos = new Map(photos.filter(p=>embeddingFor(p)).map(p=>[p.id,p]));
      const referenceVectors = memories.flatMap(m=>m.photoIds.slice(0,2)).map(id=>referencePhotos.get(id)).filter((p):p is Photo=>!!p).map(p=>embeddingFor(p)!);
      const affinity = (id:string) => linked.has(id) ? 1 : Math.max(-1,...referenceVectors.map(v=>embeddingFor(indexedById.get(id)!)!.reduce((sum,x,i)=>sum+x*v[i],0)));
      const pool = memories.length ? results.map(p=>({...p,similarity:Math.max(p.similarity,affinity(p.id))})).sort((a,b)=>b.similarity-a.similarity) : results;
      const candidates = pool.slice(0,12);
      const verificationKey = JSON.stringify([selected,query,candidates.map(p=>p.id),memories]);
      let verification = verifiedQueries.get(verificationKey);
      const verificationCached = !!verification;
      if (!verification) {
        const images = await Promise.all(candidates.map(async p=>({id:p.id,bytes:await readFile(resolve(datasetDir,`${p.id}.jpg`))})));
        step = 'visual check'; verificationCalls++;
        const references = [];
        for (const m of memories) for (const id of m.photoIds.slice(0,2)) references.push({label:JSON.stringify({entityId:m.id,name:m.name,qualifier:m.qualifier}),bytes:await readFile(resolve(datasetDir,`${id}.jpg`))});
        const facts = {entities:memories,bindings:contextUsed,candidates:candidates.map(p=>({id:p.id,confirmedEntityIds:memories.filter(m=>m.photoIds.includes(p.id)).map(m=>m.id)}))};
        verification = validateVerification(await provider.verify(query,images,memories.length ? {facts,references} : undefined),candidates.map(p=>p.id));
        if (verifiedQueries.size >= 50) verifiedQueries.delete(verifiedQueries.keys().next().value!);
        verifiedQueries.set(verificationKey,verification);
      }
      const priorities = { match:0, uncertain:1, mismatch:2 };
      const checked = candidates.map(p=>({ ...p, verification: verification!.results.find(r=>r.id===p.id)! }))
        .sort((a,b)=>priorities[a.verification.verdict as keyof typeof priorities]-priorities[b.verification.verdict as keyof typeof priorities] || b.similarity-a.similarity);
      return { results: checked, cached, model: CONFIG[selected].model, verified:true, verificationCached, verificationModel: CONFIG[selected].vision,
        contextUsed, requirements:verification.requirements, checked:candidates.length, totalCandidates:results.length };

    } catch (e) { return reply.code(502).send({ message: providerError(e,step) }); }
    finally { searching = false; }
  });
  server.addHook('onClose', async () => { pause = true; if (task) await task; provider = null; contextStore.close(); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createPlaygroundServer();
  await server.listen({ host: '127.0.0.1', port: 8790 });
  console.log('Captured ready at http://127.0.0.1:8790');
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
