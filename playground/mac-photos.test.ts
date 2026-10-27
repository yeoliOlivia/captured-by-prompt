import { afterEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { registerTripStudio, type StudioPhoto } from './trip-studio.js';
import { registerMacPhotos, type MacPhotoMetadata } from './mac-photos.js';
import { createPlaygroundServer } from './server.js';

const cleanups:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const clientId=randomUUID(),albumId='album/library/one';
const modifiedAt='2026-10-28T12:00:00Z';
const jpeg=async(color='red')=>(await sharp({create:{width:20,height:20,channels:3,background:color}}).jpeg().toBuffer()).toString('base64');
async function setup(options:{dir?:string;photos?:Map<string,StudioPhoto>;isBusy?:()=>boolean;beforeImport?:()=>Promise<void>}={}) {
  const dir=options.dir ?? await mkdtemp(join(tmpdir(),'captured-mac-import-'));
  if(!options.dir)cleanups.push(()=>rm(dir,{recursive:true,force:true}));
  const server=Fastify(),photos=options.photos ?? new Map<string,StudioPhoto>();
  const studio=registerTripStudio(server,{datasetDir:dir,getPhotos:()=>[...photos.values()]});
  const imported:MacPhotoMetadata[]=[];
  const importer=registerMacPhotos(server,{datasetDir:dir,studio,isBusy:options.isBusy,importPhoto:async(bytes,metadata)=>{
    await options.beforeImport?.();
    imported.push(metadata);
    const id=createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(dir,`${id}.jpg`),bytes);
    photos.set(id,{id,...metadata});return {id};
  }});
  cleanups.push(()=>server.close());
  const post=(path:string,payload:unknown,remoteAddress='127.0.0.1')=>server.inject({method:'POST',url:`/api/studio/mac/imports/${path}`,payload,remoteAddress});
  const connect=(values:Record<string,unknown>={})=>post('connect',{clientId,albumId,albumTitle:'Our weekend',...values});
  const asset=async(connectionId:string,values:Record<string,unknown>={})=>post('asset',{connectionId,assetId:'asset/one',modifiedAt,name:'IMG_001.jpg',jpegBase64:await jpeg(),capturedAt:'2026-10-26T15:30:00-04:00',place:{lat:35.68123,lon:139.76945},...values});
  return {server,studio,photos,dir,imported,importer,post,connect,asset};
}

it('reconnects one device album to one trip and isolates different albums and devices',async()=>{
  const t=await setup(),first=(await t.connect()).json();
  expect(first).toMatchObject({reused:false,assets:[]});
  const again=(await t.connect({albumTitle:'New source title'})).json();
  expect(again).toMatchObject({reused:true,connectionId:first.connectionId,tripId:first.tripId});
  expect(t.studio.details(first.tripId).trip.title).toBe('Our weekend');
  const otherDevice=(await t.connect({clientId:randomUUID()})).json();
  const otherAlbum=(await t.connect({albumId:'another-album'})).json();
  expect(new Set([first.tripId,otherDevice.tripId,otherAlbum.tripId]).size).toBe(3);
  expect(t.imported).toEqual([]);
});

it('recovers a reserved connection when trip creation completes but its response fails',async()=>{
  const t=await setup(),create=t.studio.create.bind(t.studio);
  vi.spyOn(t.studio,'create').mockImplementationOnce((value,id)=>{create(value,id);throw new Error('Simulated stop after trip creation');});
  expect((await t.connect()).statusCode).toBe(500);
  expect(t.studio.list()).toHaveLength(1);
  const recovered=(await t.connect()).json();
  expect(recovered).toMatchObject({reused:true,tripId:t.studio.list()[0].id});
  expect(t.studio.list()).toHaveLength(1);
});

it('imports metadata and checkpoints only selected assets without creating AI observations',async()=>{
  const t=await setup(),connection=(await t.connect()).json();
  const response=await t.asset(connection.connectionId);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({tripId:connection.tripId,cached:false,updated:false,added:1});
  expect(t.imported).toEqual([{name:'IMG_001.jpg',capturedAt:'2026-10-26T15:30:00-04:00',place:{lat:35.68,lon:139.77}}]);
  const details=t.studio.details(connection.tripId);
  expect(details.photos).toHaveLength(1);expect(details.photos[0].annotation).toBeNull();
  expect((await t.connect()).json().assets).toEqual([{assetId:'asset/one',modifiedAt,photoId:response.json().photoId}]);
  expect((await t.asset(connection.connectionId)).json()).toMatchObject({cached:true,added:0});
  expect((await t.asset(connection.connectionId,{jpegBase64:'not base64'})).statusCode).toBe(400);
  expect(t.imported).toHaveLength(1);
});

it('keeps durable resume checkpoints across server restarts',async()=>{
  const first=await setup(),connection=(await first.connect()).json();
  const photo=(await first.asset(connection.connectionId)).json();await first.server.close();
  const restarted=await setup({dir:first.dir,photos:first.photos});
  expect((await restarted.connect()).json()).toMatchObject({connectionId:connection.connectionId,tripId:connection.tripId,assets:[{photoId:photo.photoId}]});
  expect((await restarted.asset(connection.connectionId)).json().cached).toBe(true);
  expect(restarted.imported).toHaveLength(0);
});

it('resends missing previews even if a stale in-memory photo and ledger remain',async()=>{
  const t=await setup(),connection=(await t.connect()).json();
  const first=(await t.asset(connection.connectionId)).json();
  await rm(join(t.dir,`${first.photoId}.jpg`));
  expect((await t.connect()).json().assets).toEqual([]);
  expect((await t.asset(connection.connectionId)).json()).toMatchObject({cached:false,photoId:first.photoId,added:0});
  expect(t.imported).toHaveLength(2);
  expect((await t.connect()).json().assets).toHaveLength(1);
});

it('imports edits without removing prior trip photos and rejects older revision replays',async()=>{
  const t=await setup(),connection=(await t.connect()).json();
  const old=(await t.asset(connection.connectionId)).json();
  const updated=(await t.asset(connection.connectionId,{modifiedAt:'2026-10-29T12:00:00Z',jpegBase64:await jpeg('blue')})).json();
  expect(updated).toMatchObject({cached:false,updated:true,added:1});
  expect(t.studio.details(connection.tripId).photos.map(p=>p.id)).toEqual([old.photoId,updated.photoId]);
  expect((await t.asset(connection.connectionId)).statusCode).toBe(409);
  expect(t.imported).toHaveLength(2);
  expect((await t.connect()).json().assets).toEqual([{assetId:'asset/one',modifiedAt:'2026-10-29T12:00:00Z',photoId:updated.photoId}]);
});

it('never treats an unknown source modification date as an unchanged photo',async()=>{
  const t=await setup(),connection=(await t.connect()).json();
  await t.asset(connection.connectionId,{modifiedAt:null,capturedAt:null,place:null});
  expect((await t.asset(connection.connectionId,{modifiedAt:null,capturedAt:null,place:null})).json()).toMatchObject({cached:false,added:0});
  expect(t.imported).toHaveLength(2);
});

it('does not checkpoint an unattached upload and retries it without duplicating trip membership',async()=>{
  const t=await setup(),connection=(await t.connect()).json();
  vi.spyOn(t.studio,'attach').mockImplementationOnce(()=>{throw new Error('Simulated stop before membership commit');});
  expect((await t.asset(connection.connectionId)).statusCode).toBe(500);
  expect((await t.connect()).json().assets).toEqual([]);
  expect(t.photos.size).toBe(1);
  expect((await t.asset(connection.connectionId)).json()).toMatchObject({added:1,cached:false});
  expect(t.studio.details(connection.tripId).photos).toHaveLength(1);
});

it('blocks competing processes and workspace operations while preserving resumable progress',async()=>{
  let release!:()=>void,entered!:()=>void,busy=true;
  const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  const first=await setup({isBusy:()=>busy,beforeImport:async()=>{entered();await gate;}});
  const connection=(await first.connect()).json();
  expect((await first.asset(connection.connectionId)).statusCode).toBe(409);
  busy=false;const pending=first.asset(connection.connectionId);await started;
  const other=await setup({dir:first.dir,photos:first.photos});
  try {
    expect(first.importer.isRunning()).toBe(true);expect(other.importer.isRunning()).toBe(true);
    expect((await other.asset(connection.connectionId)).statusCode).toBe(409);
    expect(other.imported).toHaveLength(0);
  } finally {release();await pending;}
  expect(first.importer.isRunning()).toBe(false);expect(other.importer.isRunning()).toBe(false);
  expect((await other.asset(connection.connectionId)).json().cached).toBe(true);
});

it('rejects remote callers, unknown connections, malformed previews and invalid metadata before ingestion',async()=>{
  const t=await setup();
  expect((await t.post('connect',{clientId,albumId,albumTitle:'Remote'},'192.168.1.9')).statusCode).toBe(403);
  expect(t.studio.list()).toEqual([]);
  const connection=(await t.connect()).json();
  expect((await t.asset(randomUUID())).statusCode).toBe(404);
  for(const invalid of [
    {place:{lat:91,lon:0}}, {capturedAt:'2026-10-26'}, {modifiedAt:'not-a-date'},
    {jpegBase64:'not base64'}, {jpegBase64:Buffer.from('not a JPEG').toString('base64')},
    {jpegBase64:Buffer.alloc(2*1024*1024+1,0xff).toString('base64')}, {name:''}, {assetId:'bad\nidentifier'},
  ])expect((await t.asset(connection.connectionId,invalid)).statusCode).toBe(400);
  expect(t.imported).toHaveLength(0);expect((await t.connect()).json().assets).toEqual([]);
});

it('imports through the real workspace routes with session protection, metadata, and no provider calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'captured-mac-routes-'));
  cleanups.push(()=>rm(dir,{recursive:true,force:true}));
  const factory=vi.fn(()=>{throw new Error('An import must never create a model connection');});
  const server=await createPlaygroundServer({datasetDir:dir,providerFactory:factory});
  cleanups.push(()=>server.close());
  const headers:Record<string,string>={host:'127.0.0.1'};
  const connectBody={clientId,albumId,albumTitle:'Actual Photos import'};
  expect((await server.inject({method:'POST',url:'/api/studio/mac/imports/connect',headers,payload:connectBody})).statusCode).toBe(403);
  headers['x-playground-session']=(await server.inject({url:'/studio',headers})).body.match(/name="playground-session" content="([^"]+)"/)![1];
  const connection=(await server.inject({method:'POST',url:'/api/studio/mac/imports/connect',headers,payload:connectBody})).json();
  const imported=await server.inject({method:'POST',url:'/api/studio/mac/imports/asset',headers,payload:{
    connectionId:connection.connectionId,assetId:'actual-photos-asset',modifiedAt,name:'Library image.jpg',
    jpegBase64:await jpeg(),capturedAt:'2026-10-26T15:30:00-04:00',place:{lat:35.68123,lon:139.76945},
  }});
  expect(imported.statusCode).toBe(200);
  const detail=(await server.inject({url:`/api/studio/trips/${connection.tripId}`,headers})).json();
  expect(detail.photos).toHaveLength(1);
  expect(detail.photos[0]).toMatchObject({id:imported.json().photoId,indexed:false,capturedAt:'2026-10-26T15:30:00-04:00',place:{lat:35.68,lon:139.77},annotation:null});
  expect((await server.inject({url:'/state',headers})).json()).toMatchObject({configured:false,indexed:0,total:1,imageCalls:0,queryCalls:0});
  expect(factory).not.toHaveBeenCalled();
});
