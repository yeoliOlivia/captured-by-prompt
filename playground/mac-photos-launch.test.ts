import { afterEach, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerMacPhotosLauncher } from './mac-photos-launch.js';
const cleanup: (()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse()) await close();});

it('launches only the fixed local companion and never launches on a status read',async()=>{
  const appPath=await mkdtemp(join(tmpdir(),'mac-photos-launch-'));cleanup.push(()=>rm(appPath,{recursive:true,force:true}));
  await mkdir(join(appPath,'Contents/MacOS'),{recursive:true});await writeFile(join(appPath,'Contents/MacOS/AfterglowPhotos'),'fixture');
  const server=Fastify();cleanup.push(()=>server.close());
  const calls:string[]=[];registerMacPhotosLauncher(server,{platform:'darwin',appPath,launch:async path=>{calls.push(path);}});
  const headers={host:'127.0.0.1:8790'};
  expect((await server.inject({url:'/api/studio/mac/status',headers})).json()).toMatchObject({supported:true,available:true});
  expect(calls).toEqual([]);
  expect((await server.inject({method:'POST',url:'/api/studio/mac/launch',headers,payload:{path:'/untrusted'}})).json()).toEqual({opened:true});
  expect(calls).toEqual([appPath]);
  expect((await server.inject({method:'POST',url:'/api/studio/mac/launch',headers,remoteAddress:'192.168.1.9'})).statusCode).toBe(403);
  expect((await server.inject({method:'POST',url:'/api/studio/mac/launch',headers:{host:'127.0.0.1:9000'}})).statusCode).toBe(409);
  expect(calls).toHaveLength(1);
});

it('reports a missing build without opening or exposing local files',async()=>{
  const server=Fastify();cleanup.push(()=>server.close());registerMacPhotosLauncher(server,{platform:'darwin',appPath:'/nonexistent/Afterglow.app',launch:async()=>{throw new Error('Must not launch');}});
  const result=await server.inject({method:'POST',url:'/api/studio/mac/launch',headers:{host:'127.0.0.1:8790'}});
  expect(result.statusCode).toBe(503);expect(result.json().message).toContain('build:mac-photos');
});
