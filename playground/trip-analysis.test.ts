import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { registerTripStudio } from './trip-studio.js';
import { registerStudioAnalysis } from './trip-analysis.js';
import { validateObservations } from './trip-observations.js';
import { vector, type Provider } from './providers.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const id = 'a'.repeat(64), other = 'b'.repeat(64);
const result = { id, scene:'people', activities:['walking'], vibes:['warm light'], aesthetic:78, smilesVisible:true, facesClear:null, evidence:'Two visible smiles, with one face partly obscured.' };
async function setup(observe: NonNullable<Provider['observe']> = async () => ({results:[result]}), dir?: string, options: {
  embeddings?: boolean; photoIds?: string[]; image?: Provider['image']; saved?: Map<string, number[]>; isBusy?: () => boolean;
} = {}) {
  const folder = dir ?? await mkdtemp(join(tmpdir(),'captured-analysis-'));
  if (!dir) cleanups.push(() => rm(folder,{recursive:true,force:true}));
  const photoIds = options.photoIds ?? [id], saved = options.saved ?? new Map<string,number[]>();
  for (const photoId of photoIds) await writeFile(join(folder,`${photoId}.jpg`), `mock image ${photoId}, provider mocked`);
  const server = Fastify();
  server.setErrorHandler((error, _req, reply) => reply.code(400).send({message:error.message}));
  const store = registerTripStudio(server,{datasetDir:folder,getPhotos:()=>photoIds.map(id => ({id,name:`${id}.jpg`}))});
  const connection = {
    model:'test-vision', provider:{image:options.image ?? (async()=>[1,0]),text:async()=>[1,0],observe},
    ...(options.embeddings ? {
      embeddingModel:'test-embedding', dimensions:2, hasEmbedding:(photoId:string)=>saved.has(photoId),
      saveEmbedding:async(photoId:string, values:number[])=>{saved.set(photoId,vector(values,2));},
    } : {}),
  };
  const analysis = registerStudioAnalysis(server,{datasetDir:folder,store,getProvider:()=>connection,isBusy:options.isBusy});
  cleanups.push(() => server.close());
  const trip = store.create({title:'Test trip',photoIds});
  const request = (requestId = randomUUID(), selectedIds = photoIds) => server.inject({method:'POST',url:`/api/studio/trips/${trip.id}/analyze`,payload:{requestId,photoIds:selectedIds}});
  return {server,store,trip,request,folder,analysis,saved,connection};
}

it('persists observations and avoids duplicate calls for retries and already cached photos',async()=>{
  let calls=0;
  const test = await setup(async()=>{calls++;return {results:[result]};});
  const key = randomUUID();
  expect((await test.request(key)).json().job).toMatchObject({status:'complete',processed:1});
  expect((await test.request(key)).json().job.status).toBe('complete');
  expect((await test.request()).json().job).toMatchObject({status:'complete',processed:0,cached:1});
  expect(calls).toBe(1);
  expect(test.store.details(test.trip.id).photos[0].annotation).toMatchObject({provenance:'model',aesthetic:78,members:[]});
});

it('rejects photos outside trip, invalid reused request IDs, and oversized batches before calls',async()=>{
  let calls=0;
  const test=await setup(async()=>{calls++;return {results:[result]};});
  expect((await test.request(randomUUID(),[other])).statusCode).toBe(400);
  const key=randomUUID();await test.request(key);
  expect((await test.request(key,[other])).statusCode).toBe(409);
  expect((await test.request(randomUUID(),Array.from({length:13},()=>id))).statusCode).toBe(400);
  expect(calls).toBe(1);
});

it('retains user corrections without sending their photos again',async()=>{
  let calls=0;const test=await setup(async()=>{calls++;return {results:[result]};});
  test.store.annotate(test.trip.id,{annotations:[{photoId:id,provenance:'user',scene:'scenery'}]});
  expect((await test.request()).json().job).toMatchObject({cached:0,preservedUser:1});
  expect(calls).toBe(0);
});

it('invalid or missing model results cannot create partial or invented statistics',async()=>{
  const test=await setup(async()=>({results:[{...result,id:other}]}));
  expect((await test.request()).json().job.status).toBe('failed');
  expect(test.store.insights(test.trip.id).coverage.annotatedPhotos).toBe(0);
  expect(()=>validateObservations({results:[result,result]},[id])).toThrow();
  expect(()=>validateObservations({results:[{...result,aesthetic:Infinity}]},[id])).toThrow();
});

it('rejects parallel work and never overwrites edits made during a model call',async()=>{
  let release!:()=>void, entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const test=await setup(async()=>{entered();await gate;return {results:[result]};});
  const first=test.request();await started;
  expect(test.analysis.isRunning()).toBe(true);
  expect((await test.request()).statusCode).toBe(409);
  test.store.annotate(test.trip.id,{annotations:[{photoId:id,provenance:'user',scene:'food'}]});
  release();expect((await first).json().job).toMatchObject({status:'complete',skippedChanged:1,processed:0});
  expect(test.analysis.isRunning()).toBe(false);
  expect(test.store.details(test.trip.id).photos[0].annotation?.scene).toBe('food');
});

it('marks unfinished jobs interrupted on restart without retrying paid work',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'captured-interrupted-'));
  cleanups.push(()=>rm(folder,{recursive:true,force:true}));
  const db=new DatabaseSync(join(folder,'.trip-analysis.sqlite'));
  db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  const old={id:randomUUID(),tripId:randomUUID(),photoIds:[id],status:'running'};
  db.prepare('INSERT INTO jobs VALUES (?,?)').run(old.id,JSON.stringify(old));db.close();
  let calls=0;const test=await setup(async()=>{calls++;return {results:[result]};},folder);
  const check=new DatabaseSync(join(folder,'.trip-analysis.sqlite'));
  expect(JSON.parse(String(check.prepare('SELECT data FROM jobs WHERE id=?').get(old.id)!.data)).status).toBe('interrupted');
  check.close();expect(calls).toBe(0);await test.server.ready();
});

it('blocks another server sharing the same dataset while a paid request is running',async()=>{
  let release!:()=>void, entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=await setup(async()=>{entered();await gate;return {results:[result]};});
  const running=first.request();await started;
  let duplicateCalls=0;
  const second=await setup(async()=>{duplicateCalls++;return {results:[result]};},first.folder);
  expect(second.analysis.isRunning()).toBe(true);
  expect((await second.request()).statusCode).toBe(409);
  release();expect((await running).json().job.status).toBe('complete');
  expect(second.analysis.isRunning()).toBe(false);
  expect(duplicateCalls).toBe(0);
});

it('makes previously unindexed photos searchable and reuses their image vectors on subsequent requests',async()=>{
  let calls=0, observations=0;
  const test=await setup(async()=>{observations++;return {results:[result,{...result,id:other}]};},undefined,{
    embeddings:true,photoIds:[id,other],image:async bytes=>{calls++;return bytes.toString().includes(id) ? [2,0] : [0,2];},
  });
  expect(test.saved.size).toBe(0);
  const first=(await test.request()).json().job;
  expect(first).toMatchObject({status:'complete',embedded:2,embeddingCached:0,embeddingModel:'test-embedding',dimensions:2,phase:'finished',processed:2});
  expect(first.progress).toEqual([{photoId:id,embedding:'saved',observation:'saved'},{photoId:other,embedding:'saved',observation:'saved'}]);
  const query=await test.connection.provider.text();
  const matches=[...test.saved].map(([photoId,values])=>({photoId,score:values.reduce((sum,value,i)=>sum+value*query[i]!,0)})).sort((a,b)=>b.score-a.score);
  expect(matches).toEqual([{photoId:id,score:1},{photoId:other,score:0}]);
  expect((await test.request()).json().job).toMatchObject({embedded:0,embeddingCached:2,cached:2,processed:0});
  expect(calls).toBe(2);expect(observations).toBe(1);
});

it('preserves pre-existing embeddings while still producing missing visual observations',async()=>{
  let calls=0;
  const saved=new Map([[id,[0,1]]]);
  const test=await setup(undefined,undefined,{embeddings:true,saved,image:async()=>{calls++;return [1,0];}});
  expect((await test.request()).json().job).toMatchObject({status:'complete',embedded:0,embeddingCached:1,processed:1});
  expect(calls).toBe(0);expect(saved.get(id)).toEqual([0,1]);
});

it('retains embeddings after a vision quota failure and retries only missing observations with a new request ID',async()=>{
  let calls=0,observations=0;
  const test=await setup(async()=>{
    observations++;if(observations===1)throw Object.assign(new Error('API secret must never escape'),{status:429});
    return {results:[result]};
  },undefined,{embeddings:true,image:async()=>{calls++;return [1,0];}});
  const key=randomUUID();
  const failed=(await test.request(key)).json().job;
  expect(failed).toMatchObject({status:'failed',errorCode:'quota',embedded:1,processed:0,phase:'observations'});
  expect(failed.message).toContain('1 new search embeddings');expect(failed.message).not.toContain('secret');
  expect(test.saved.has(id)).toBe(true);expect(test.store.details(test.trip.id).coverage.annotatedPhotos).toBe(0);
  expect((await test.request(key)).json().job).toEqual(failed);
  expect(observations).toBe(1);
  expect((await test.request()).json().job).toMatchObject({status:'complete',embedded:0,embeddingCached:1,processed:1});
  expect(calls).toBe(1);expect(observations).toBe(2);
});

it('checkpoints each completed embedding durably and preserves progress through a partial authentication failure',async()=>{
  let calls=0,observations=0,release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const test=await setup(async()=>{observations++;return {results:[result,{...result,id:other}]};},undefined,{
    embeddings:true,photoIds:[id,other],image:async()=>{
      calls++;if(calls===2){entered();await gate;throw Object.assign(new Error('Authorization: sensitive-key'),{status:403});}
      return [1,0];
    },
  });
  const key=randomUUID(),first=test.request(key);await started;
  const progress=(await test.server.inject({method:'GET',url:`/api/studio/trips/${test.trip.id}/analysis`})).json().jobs[0];
  expect(progress).toMatchObject({status:'running',embedded:1,currentPhotoId:other,phase:'embeddings'});
  expect(progress.progress).toEqual([{photoId:id,embedding:'saved',observation:'pending'},{photoId:other,embedding:'pending',observation:'pending'}]);
  expect((await test.request(key)).json().job).toEqual(progress);
  expect((await test.request()).statusCode).toBe(409);
  release();
  const failed=(await first).json().job;
  expect(failed).toMatchObject({status:'failed',embedded:1,errorCode:'auth',currentPhotoId:other});
  expect(failed.message).not.toContain('sensitive-key');expect(observations).toBe(0);
  const check=new DatabaseSync(join(test.folder,'.trip-analysis.sqlite'));
  expect(JSON.parse(String(check.prepare('SELECT data FROM jobs WHERE id=?').get(key)!.data))).toEqual(failed);check.close();
  expect((await test.request()).json().job).toMatchObject({status:'complete',embedded:1,embeddingCached:1,processed:2});
  expect(calls).toBe(3);expect(observations).toBe(1);
});

it('adds missing embeddings to user-edited photos without replacing their observations',async()=>{
  let observations=0,calls=0;
  const test=await setup(async()=>{observations++;return {results:[result]};},undefined,{embeddings:true,image:async()=>{calls++;return [1,0];}});
  test.store.annotate(test.trip.id,{annotations:[{photoId:id,provenance:'user',scene:'scenery'}]});
  const before=test.store.details(test.trip.id).photos[0]!.annotation;
  expect((await test.request()).json().job).toMatchObject({status:'complete',preservedUser:1,embedded:1,processed:0});
  expect(calls).toBe(1);expect(observations).toBe(0);expect(test.saved.has(id)).toBe(true);
  expect(test.store.details(test.trip.id).photos[0]!.annotation).toEqual(before);
});

it('preserves a user correction made while an image embedding is in flight',async()=>{
  let release!:()=>void,entered!:()=>void,observations=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const test=await setup(async()=>{observations++;return {results:[result]};},undefined,{
    embeddings:true,image:async()=>{entered();await gate;return [1,0];},
  });
  const running=test.request();await started;
  test.store.annotate(test.trip.id,{annotations:[{photoId:id,provenance:'user',scene:'food'}]});
  release();expect((await running).json().job).toMatchObject({status:'complete',embedded:1,preservedUser:1,processed:0});
  expect(observations).toBe(0);expect(test.store.details(test.trip.id).photos[0]!.annotation?.scene).toBe('food');
});

it.each([[1,NaN],[0,0]])('rejects invalid embedding output %j without starting observations or persisting bad vectors',async(...values:number[])=>{
  let observations=0;
  const test=await setup(async()=>{observations++;return {results:[result]};},undefined,{embeddings:true,image:async()=>values});
  expect((await test.request()).json().job).toMatchObject({status:'failed',errorCode:'output',embedded:0,processed:0});
  expect(test.saved.size).toBe(0);expect(observations).toBe(0);
});

it('keeps original idempotent results when the configured vision model changes',async()=>{
  let calls=0;
  const test=await setup(async()=>{calls++;return {results:[result]};});
  const key=randomUUID(),first=(await test.request(key)).json().job;
  test.connection.model='other-vision';
  expect((await test.request(key)).json().job).toEqual(first);
  expect(calls).toBe(1);
  expect((await test.request()).json().job).toMatchObject({status:'complete',processed:1,cached:0});
  expect(calls).toBe(2);
});

it('refuses new analysis while the existing workspace is busy without reserving a request ID or making model calls',async()=>{
  let busy=true,calls=0;
  const test=await setup(async()=>{calls++;return {results:[result]};},undefined,{isBusy:()=>busy});
  const key=randomUUID(),blocked=await test.request(key);
  expect(blocked.statusCode).toBe(409);expect(blocked.json().message).toContain('workspace operation');expect(calls).toBe(0);
  expect((await test.server.inject({method:'GET',url:`/api/studio/trips/${test.trip.id}/analysis`})).json().jobs).toEqual([]);
  busy=false;expect((await test.request(key)).json().job.status).toBe('complete');
  busy=true;expect((await test.request(key)).json().job.status).toBe('complete');expect(calls).toBe(1);
});
