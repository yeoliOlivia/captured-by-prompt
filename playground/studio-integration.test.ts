import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlaygroundServer } from './server.js';
import { CONFIG, type Provider } from './providers.js';

const cleanup: (()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const ids=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
const vec=(dim:number)=>Array.from({length:dim},(_,i)=>i===0?1:0);
async function setup(overrides:Partial<Provider>={}, existingDir?:string) {
  const dir=existingDir ?? await mkdtemp(join(tmpdir(),'studio-ai-integration-'));
  if (!existingDir) {
    cleanup.push(()=>rm(dir,{recursive:true,force:true}));
    for(const [i,id] of ids.entries()) {
      await writeFile(join(dir,`${id}.jpg`),`mocked image ${i}`);
      await writeFile(join(dir,`${id}.json`),JSON.stringify({id,name:`${i}.jpg`}));
    }
  }
  const calls={images:0,observations:0,queries:0,verifications:[] as any[]};
  const server=await createPlaygroundServer({datasetDir:dir,providerFactory:(_key,name)=>({
    image:async()=>{calls.images++;return vec(CONFIG[name].dimensions);},
    text:async()=>{calls.queries++;return vec(CONFIG[name].dimensions);},
    observe:async photos=>{calls.observations++;return {results:photos.map(photo=>({id:photo.id,scene:'people',activities:['walking'],vibes:['warm light'],aesthetic:80,smilesVisible:true,facesClear:true,evidence:'Mocked visible content.'}))};},
    plan:async(query,facts)=>({visualQuery:facts?'people smiling':query,references:query.includes('Mark')?[{term:'Mark',kind:'person'}]:[]}),
    verify:async(query,photos,context)=>{calls.verifications.push({query,photos:photos.map(p=>p.id),context});return {requirements:[query],results:photos.map(photo=>({id:photo.id,checks:[{status:'pass',evidence:'Mocked review.'}]}))};},
    ...overrides,
  })});
  cleanup.push(()=>server.close());
  const headers:Record<string,string>={host:'127.0.0.1'};
  const html=(await server.inject({url:'/studio',headers})).body;
  headers['x-playground-session']=html.match(/name="playground-session" content="([^"]+)"/)![1];
  const get=(url:string)=>server.inject({url,headers});
  const post=(url:string,payload:unknown)=>server.inject({method:'POST',url,headers,payload});
  const trip=(await post('/api/studio/trips',{title:'Actual pipeline',members:[{name:'Mark'}],photoIds:ids.slice(0,2)})).json().trip;
  const prepare=()=>post(`/api/studio/trips/${trip.id}/analyze`,{requestId:randomUUID(),photoIds:ids.slice(0,2)});
  const connect=(provider='gemini')=>post('/connect',{key:'offline-integration-key-only',provider});
  return {dir,server,get,post,trip,prepare,connect,calls};
}

it('prepares formerly unindexed trip photos, reuses persisted vectors, and preserves separate provider spaces',async()=>{
  const t=await setup();
  expect((await t.prepare()).statusCode).toBe(409);
  const status=(await t.get('/api/studio/status')).json();
  expect(status).toMatchObject({configured:false,indexed:0,total:3});
  expect(status).not.toHaveProperty('photos');expect(status).not.toHaveProperty('key');
  await t.connect();
  expect((await t.prepare()).json().job).toMatchObject({status:'complete',embedded:2,processed:2});
  expect((await t.get('/state')).json().indexed).toBe(2);
  expect((await t.get(`/api/studio/trips/${t.trip.id}`)).json().photos.every((p:any)=>p.indexed)).toBe(true);
  await t.prepare();expect(t.calls.images).toBe(2);expect(t.calls.observations).toBe(1);
  await t.connect('qwen');
  expect((await t.get('/api/studio/status')).json().indexed).toBe(0);
  expect((await t.prepare()).json().job).toMatchObject({embedded:2,processed:2});
  const saved=JSON.parse(await readFile(join(t.dir,`${ids[0]}.json`),'utf8'));
  expect(saved.embeddings['gemini-embedding-2:3072']).toHaveLength(3072);
  expect(saved.embeddings['qwen3-vl-embedding:2560']).toHaveLength(2560);
  expect((await t.get('/state')).json().photos.find((p:any)=>p.id===ids[2]).indexed).toBe(false);
});

it('grounds named search in confirmed trip people and never includes another trip’s photos',async()=>{
  const t=await setup();await t.connect();await t.prepare();
  const details=(await t.get(`/api/studio/trips/${t.trip.id}`)).json();
  const existing=details.photos[0].annotation;
  await t.post(`/api/studio/trips/${t.trip.id}/annotations`,{annotations:[{photoId:ids[0],revision:existing.revision,provenance:'user',members:[{memberId:t.trip.members[0].id,status:'confirmed'}]}]});
  const search=await t.post('/search',{query:'Mark smiling',studioTripId:t.trip.id,photoIds:ids,context:true,verify:true});
  expect(search.statusCode).toBe(200);
  expect(search.json().contextUsed[0].name).toBe('Mark');
  expect(t.calls.verifications[0].photos.sort()).toEqual(ids.slice(0,2));
  const facts=t.calls.verifications[0].context.facts;
  expect(facts.candidates.find((p:any)=>p.id===ids[0]).confirmedEntityIds).toEqual([t.trip.members[0].id]);
  expect(facts.entities[0].photoIds).toEqual([ids[0]]);
  const updated=(await t.get(`/api/studio/trips/${t.trip.id}`)).json().photos[0].annotation;
  await t.post(`/api/studio/trips/${t.trip.id}/annotations`,{annotations:[{photoId:ids[0],revision:updated.revision,provenance:'user',members:[]}]});
  const unknown=await t.post('/search',{query:'Mark smiling',studioTripId:t.trip.id,context:true,verify:true});
  expect(unknown.json()).toMatchObject({needsClarification:true,questions:[{needsExamples:true}]});
  expect(t.calls.verifications).toHaveLength(1);
});

it('coordinates trip preparation with provider switching and legacy search/index operations',async()=>{
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(r=>{entered=r;});const gate=new Promise<void>(r=>{release=r;});
  const t=await setup({image:async()=>{entered();await gate;return vec(3072);}});await t.connect();
  const pending=t.prepare();await started;
  try {
    expect((await t.get('/api/studio/status')).json().analyzing).toBe(true);
    for(const [path,payload] of [['/disconnect',{}],['/connect',{key:'offline-integration-key-only',provider:'qwen'}],['/index',{}],['/search',{query:'people'}]] as const) expect((await t.post(path,payload)).statusCode).toBe(409);
  } finally {release();await pending;}
  expect((await t.get('/api/studio/status')).json().analyzing).toBe(false);
});

it('refreshes stale server caches before billing and preserves embeddings saved by another server',async()=>{
  const first=await setup(),second=await setup({},first.dir);
  await first.connect();await second.connect();
  expect((await first.prepare()).json().job).toMatchObject({status:'complete',embedded:2});
  expect((await second.prepare()).json().job).toMatchObject({status:'complete',embedded:0,embeddingCached:2});
  expect(second.calls.images).toBe(0);
  await second.connect('qwen');
  expect((await second.prepare()).json().job).toMatchObject({status:'complete',embedded:2});
  for(const id of ids.slice(0,2)) {
    const saved=JSON.parse(await readFile(join(first.dir,`${id}.json`),'utf8'));
    expect(saved.embeddings['gemini-embedding-2:3072']).toHaveLength(3072);
    expect(saved.embeddings['qwen3-vl-embedding:2560']).toHaveLength(2560);
  }
  await first.connect('qwen');
  expect((await first.prepare()).json().job).toMatchObject({status:'complete',embedded:0,embeddingCached:2});
  expect(first.calls.images).toBe(2);
  expect((await first.get('/state')).json().indexed).toBe(2);
});

it('legacy indexing also refreshes caches before making duplicate image calls and finishes a cached-only batch',async()=>{
  const first=await setup(),second=await setup({},first.dir);
  await first.connect();await second.connect();await first.prepare();
  expect((await second.post('/index',{photoIds:ids.slice(0,2)})).statusCode).toBe(202);
  const state=(await second.get('/state')).json();
  expect(state).toMatchObject({indexing:false,indexed:2});
  expect(second.calls.images).toBe(0);
});

it('merges provider caches written to disk after an embedding request started',async()=>{
  let folder='';
  const t=await setup({image:async bytes=>{
    const photoId=ids[Number(bytes.toString().split(' ').at(-1))]!;
    const path=join(folder,`${photoId}.json`),saved=JSON.parse(await readFile(path,'utf8'));
    await writeFile(path,JSON.stringify({...saved,name:'updated-name.jpg',capturedAt:'2026-10-27T10:00:00',externalMetadata:'preserve me',embeddings:{...saved.embeddings,'qwen3-vl-embedding:2560':vec(2560)}}));
    return vec(3072);
  }});
  folder=t.dir;await t.connect();
  expect((await t.prepare()).json().job).toMatchObject({status:'complete',embedded:2});
  const saved=JSON.parse(await readFile(join(t.dir,`${ids[0]}.json`),'utf8'));
  expect(saved).toMatchObject({name:'updated-name.jpg',capturedAt:'2026-10-27T10:00:00',externalMetadata:'preserve me'});
  expect(saved.embeddings['gemini-embedding-2:3072']).toHaveLength(3072);
  expect(saved.embeddings['qwen3-vl-embedding:2560']).toHaveLength(2560);
});

it('does not replace a damaged disk record with a stale memory copy after a provider returns',async()=>{
  let folder='',calls=0;
  const malformed='{"embeddings":';
  const t=await setup({image:async()=>{
    calls++;await writeFile(join(folder,`${ids[0]}.json`),malformed);return vec(3072);
  }});
  folder=t.dir;await t.connect();
  expect((await t.prepare()).json().job).toMatchObject({status:'failed',embedded:0,errorCode:'storage'});
  expect(await readFile(join(t.dir,`${ids[0]}.json`),'utf8')).toBe(malformed);
  expect(calls).toBe(1);expect(t.calls.observations).toBe(0);
  expect((await t.prepare()).statusCode).toBe(400);
  expect(calls).toBe(1);
});
