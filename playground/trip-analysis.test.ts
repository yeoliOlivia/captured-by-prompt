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
import type { Provider } from './providers.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const id = 'a'.repeat(64), other = 'b'.repeat(64);
const result = { id, scene:'people', activities:['walking'], vibes:['warm light'], aesthetic:78, smilesVisible:true, facesClear:null, evidence:'Two visible smiles, with one face partly obscured.' };
async function setup(observe: NonNullable<Provider['observe']> = async () => ({results:[result]}), dir?: string) {
  const folder = dir ?? await mkdtemp(join(tmpdir(),'captured-analysis-'));
  if (!dir) cleanups.push(() => rm(folder,{recursive:true,force:true}));
  await writeFile(join(folder,`${id}.jpg`), 'mock image, provider mocked');
  const server = Fastify();
  server.setErrorHandler((error, _req, reply) => reply.code(400).send({message:error.message}));
  const store = registerTripStudio(server,{datasetDir:folder,getPhotos:()=>[{id,name:'a.jpg'}]});
  registerStudioAnalysis(server,{datasetDir:folder,store,getProvider:()=>({model:'test-vision',provider:{image:async()=>[],text:async()=>[],observe}})});
  cleanups.push(() => server.close());
  const trip = store.create({title:'Test trip',photoIds:[id]});
  const request = (requestId = randomUUID(), photoIds = [id]) => server.inject({method:'POST',url:`/api/studio/trips/${trip.id}/analyze`,payload:{requestId,photoIds}});
  return {server,store,trip,request,folder};
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
  expect((await test.request()).statusCode).toBe(409);
  test.store.annotate(test.trip.id,{annotations:[{photoId:id,provenance:'user',scene:'food'}]});
  release();expect((await first).json().job).toMatchObject({status:'complete',skippedChanged:1,processed:0});
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
  expect((await second.request()).statusCode).toBe(409);
  release();expect((await running).json().job.status).toBe('complete');
  expect(duplicateCalls).toBe(0);
});
