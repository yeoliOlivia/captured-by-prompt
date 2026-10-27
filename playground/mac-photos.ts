import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { openTripStudio } from './trip-studio.js';

const MAX_JPEG_BYTES = 2 * 1024 * 1024;
const Identifier = z.string().trim().min(1).max(1024).refine(value => !/[\x00-\x1f]/.test(value));
const Timestamp = z.string().datetime({ offset: true }).max(80).nullable();
const ConnectInput = z.object({
  clientId:z.string().uuid(), albumId:Identifier, albumTitle:z.string().trim().min(1).max(500),
}).strict();
const AssetInput = z.object({
  connectionId:z.string().uuid(), assetId:Identifier, modifiedAt:Timestamp.default(null),
  name:z.string().trim().min(1).max(200), jpegBase64:z.string().min(4).max(Math.ceil(MAX_JPEG_BYTES / 3) * 4),
  capturedAt:Timestamp.default(null),
  place:z.object({lat:z.number().finite().min(-90).max(90),lon:z.number().finite().min(-180).max(180)}).strict().nullable().default(null),
}).strict();
export type MacPhotoMetadata = Pick<z.infer<typeof AssetInput>, 'name'|'capturedAt'|'place'>;
type Connection = {id:string;clientId:string;albumId:string;albumTitle:string;tripId:string};
type Asset = {assetId:string;modifiedAt:string|null;photoId:string};
class ImportError extends Error {
  constructor(message:string, readonly statusCode=400) {super(message);}
}
const ownerAlive = (pid:number) => {
  try {process.kill(pid,0);return true;} catch (error) {return (error as NodeJS.ErrnoException).code === 'EPERM';}
};

// A user-selected Photos album is imported into one local trip. This ledger is
// private, device-scoped, and separate from the portable photo/embedding bundle.
export function registerMacPhotos(server:FastifyInstance, options:{
  datasetDir:string;
  studio:ReturnType<typeof openTripStudio>;
  importPhoto:(bytes:Buffer, metadata:MacPhotoMetadata)=>Promise<{id:string}>;
  isBusy?:()=>boolean;
}) {
  mkdirSync(options.datasetDir,{recursive:true});
  const path=resolve(options.datasetDir,'.mac-photos.sqlite');
  const db=new DatabaseSync(path);chmodSync(path,0o600);
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version)>1) {
    db.close();throw new Error('Update the app before opening this Mac Photos import ledger.');
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, album_id TEXT NOT NULL,
      album_title TEXT NOT NULL, trip_id TEXT NOT NULL UNIQUE,
      UNIQUE(client_id,album_id));
    CREATE TABLE IF NOT EXISTS assets (
      connection_id TEXT NOT NULL REFERENCES connections(id), asset_id TEXT NOT NULL,
      modified_at TEXT, photo_id TEXT NOT NULL, PRIMARY KEY(connection_id,asset_id));
    CREATE TABLE IF NOT EXISTS import_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner_pid INTEGER NOT NULL, nonce TEXT NOT NULL);
    PRAGMA user_version=1;`);
  let active:Promise<unknown>|null=null;
  const transaction=<T>(operation:()=>T):T=>{
    db.exec('BEGIN IMMEDIATE');
    try {const result=operation();db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  };
  const lease=()=>db.prepare('SELECT owner_pid,nonce FROM import_lease WHERE id=1').get();
  const running=()=>{const row=lease();return Boolean(active || row && ownerAlive(Number(row.owner_pid)));};
  const connection=(id:string):Connection=>{
    const row=db.prepare('SELECT id,client_id AS clientId,album_id AS albumId,album_title AS albumTitle,trip_id AS tripId FROM connections WHERE id=?').get(id);
    if(!row)throw new ImportError('This album is not connected to this workspace.',404);
    return row as unknown as Connection;
  };
  const assets=(id:string):Asset[]=>db.prepare('SELECT asset_id AS assetId,modified_at AS modifiedAt,photo_id AS photoId FROM assets WHERE connection_id=? ORDER BY asset_id').all(id) as unknown as Asset[];
  const previewExists=(id:string)=>existsSync(resolve(options.datasetDir,`${id}.jpg`));
  const call=(operation:(request:FastifyRequest)=>unknown)=>async(request:FastifyRequest,reply:FastifyReply)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip))return reply.code(403).send({message:'Mac Photos imports must run on this Mac.'});
    try {return await operation(request);}
    catch(error){
      if(error instanceof ImportError)return reply.code(error.statusCode).send({message:error.message});
      if(error instanceof z.ZodError)return reply.code(400).send({message:'Check the album, photo identifiers, dates, coordinates, and preview size.'});
      const status=Number((error as {statusCode?:number})?.statusCode);
      if(status===409)return reply.code(409).send({message:'The workspace changed or is busy. Refresh its status and retry this import.'});
      if(status===400)return reply.code(400).send({message:'The workspace could not import this photo. Check the image and collection capacity.'});
      return reply.code(500).send({message:'The import could not finish. Saved photos remain intact; retry to resume.'});
    }
  };
  server.post('/api/studio/mac/imports/connect',call(request=>{
    const input=ConnectInput.parse(request.body);
    // Reserve a stable trip ID before creating it. Both reservation and trip
    // creation are idempotent, including a crash between these two writes.
    const reserved=transaction(()=>{
      const row=db.prepare('SELECT id FROM connections WHERE client_id=? AND album_id=?').get(input.clientId,input.albumId);
      if(row){db.prepare('UPDATE connections SET album_title=? WHERE id=?').run(input.albumTitle,String(row.id));return {id:String(row.id),reused:true};}
      if(Number(db.prepare('SELECT count(*) AS count FROM connections').get()!.count)>=200)throw new ImportError('This workspace supports 200 connected Photos albums.');
      const id=randomUUID();
      db.prepare('INSERT INTO connections VALUES (?,?,?,?,?)').run(id,input.clientId,input.albumId,input.albumTitle,randomUUID());
      return {id,reused:false};
    });
    const saved=connection(reserved.id);
    options.studio.create({title:saved.albumTitle.slice(0,140),description:'Imported from an album you selected in Apple Photos.'},saved.tripId);
    const available=new Set(options.studio.details(saved.tripId).photos.map(photo=>photo.id));
    // Missing previews must be sent again, never hidden by a stale checkpoint.
    return {connectionId:saved.id,tripId:saved.tripId,reused:reserved.reused,assets:assets(saved.id).filter(asset=>available.has(asset.photoId) && previewExists(asset.photoId))};
  }));
  server.post('/api/studio/mac/imports/asset',{bodyLimit:3*1024*1024},call(async request=>{
    const input=AssetInput.parse(request.body),saved=connection(input.connectionId);
    if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.jpegBase64))throw new ImportError('Send a JPEG preview encoded as base64.');
    const bytes=Buffer.from(input.jpegBase64,'base64');
    if(bytes.length>MAX_JPEG_BYTES || bytes.toString('base64')!==input.jpegBase64 || bytes.length<4 || bytes[0]!==0xff || bytes[1]!==0xd8 || bytes[2]!==0xff)throw new ImportError('Send a JPEG preview no larger than 2 MB.');
    let details:ReturnType<typeof options.studio.details>;
    try {details=options.studio.details(saved.tripId);}catch{throw new ImportError('Reconnect this album before importing photos.',409);}
    let previous=assets(saved.id).find(asset=>asset.assetId===input.assetId);
    const available=new Set(details.photos.map(photo=>photo.id));
    if(previous && input.modifiedAt!==null && previous.modifiedAt!==null && Date.parse(input.modifiedAt)===Date.parse(previous.modifiedAt) && available.has(previous.photoId) && previewExists(previous.photoId)) {
      return {photoId:previous.photoId,tripId:saved.tripId,cached:true,updated:false,added:0};
    }
    if(previous?.modifiedAt && input.modifiedAt && Date.parse(input.modifiedAt)<Date.parse(previous.modifiedAt))throw new ImportError('A newer version of this photo was already imported. Refresh the album before retrying.',409);
    if(active || options.isBusy?.())throw new ImportError('Wait for the current workspace operation to finish.',409);
    const nonce=randomUUID();
    transaction(()=>{
      const row=lease();
      if(row && ownerAlive(Number(row.owner_pid)))throw new ImportError('Another Mac Photos import is running. Retry after it finishes.',409);
      db.prepare('INSERT OR REPLACE INTO import_lease VALUES (1,?,?)').run(process.pid,nonce);
    });
    const run=async()=>{
      try {
        // The other process may have finished between our initial read and the
        // lease reservation. Re-check before sending or replacing a revision.
        previous=assets(saved.id).find(asset=>asset.assetId===input.assetId);
        const current=new Set(options.studio.details(saved.tripId).photos.map(photo=>photo.id));
        if(previous && input.modifiedAt!==null && previous.modifiedAt!==null && Date.parse(input.modifiedAt)===Date.parse(previous.modifiedAt) && current.has(previous.photoId) && previewExists(previous.photoId))return {photoId:previous.photoId,tripId:saved.tripId,cached:true,updated:false,added:0};
        if(previous?.modifiedAt && input.modifiedAt && Date.parse(input.modifiedAt)<Date.parse(previous.modifiedAt))throw new ImportError('A newer version of this photo was already imported. Refresh the album before retrying.',409);
        const place=input.place ? {lat:Math.round(input.place.lat*100)/100,lon:Math.round(input.place.lon*100)/100} : null;
        const photo=await options.importPhoto(bytes,{name:input.name,capturedAt:input.capturedAt,place});
        const photoId=z.string().regex(/^[a-f0-9]{64}$/).parse(photo.id);
        const attached=options.studio.attach(saved.tripId,{photoIds:[photoId]});
        // Checkpoint only after attachment. A failure between upload and this
        // write is safe to retry: content-addressed ingestion and attach reuse it.
        db.prepare(`INSERT INTO assets VALUES (?,?,?,?) ON CONFLICT(connection_id,asset_id)
          DO UPDATE SET modified_at=excluded.modified_at,photo_id=excluded.photo_id`).run(saved.id,input.assetId,input.modifiedAt,photoId);
        return {photoId,tripId:saved.tripId,cached:false,updated:Boolean(previous && previous.photoId!==photoId),added:attached.added};
      } finally {db.prepare('DELETE FROM import_lease WHERE id=1 AND nonce=?').run(nonce);}
    };
    active=run();
    try{return await active;}finally{active=null;}
  }));
  server.addHook('onClose',async()=>{if(active)await active;db.close();});
  return {isRunning:running};
}
