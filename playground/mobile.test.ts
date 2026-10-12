import { describe,it,expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPlaygroundServer } from './server';
import { WorkspaceState } from '@captured/core/current';

describe('one workspace for native and browser clients',()=>{
  it('requires mobile authentication for every LAN route and keeps browser CSRF protection',async()=>{
    const datasetDir=await mkdtemp(join(tmpdir(),'captured-auth-'));
    const server=await createPlaygroundServer({datasetDir,mobileToken:'t'.repeat(64)});
    try {
      for(const url of ['/state','/context','/photos/'+'a'.repeat(64),'/']) {
        expect((await server.inject({url,headers:{host:'192.168.1.2:8790'}})).statusCode).toBe(401);
      }
      expect((await server.inject({url:'/state',headers:{host:'192.168.1.2:8790',authorization:'Bearer wrong'}})).statusCode).toBe(401);
      expect((await server.inject({url:'/state',headers:{host:'localhost'},remoteAddress:'192.168.1.50'})).statusCode).toBe(401);
      const headers={host:'192.168.1.2:8790',authorization:`Bearer ${'t'.repeat(64)}`};
      const response=await server.inject({url:'/state',headers});expect(response.statusCode).toBe(200);
      expect(WorkspaceState.safeParse(response.json()).success).toBe(true);
      expect((await server.inject({url:'/state',headers:{...headers,origin:'https://evil.example'}})).statusCode).toBe(403);
      expect((await server.inject({method:'POST',url:'/pause',headers:{host:'localhost'},payload:{}})).statusCode).toBe(403);
      expect((await server.inject({method:'POST',url:'/pause',headers,payload:{}})).statusCode).toBe(200);
      const identity=response.json().datasetId;await server.close();
      const restarted=await createPlaygroundServer({datasetDir});
      try {
        expect((await restarted.inject({url:'/state',headers:{host:'localhost'}})).json().datasetId).toBe(identity);
        expect((await restarted.inject({url:'/state',headers})).statusCode).toBe(401);
      }finally{await restarted.close();}
    }finally{await server.close();}
  });
  it('indexes and searches only selected phone photos while sharing provider/context behavior',async()=>{
    const datasetDir=await mkdtemp(join(tmpdir(),'captured-scope-'));
    let calls=0;
    const vec=Array.from({length:3072},(_,i)=>i===0?1:0);
    const providerFactory=()=>({image:async()=>{calls++;return vec;},text:async()=>vec,plan:async()=>({visualQuery:'person',references:[{term:'Mark',kind:'person'}]})});
    const server=await createPlaygroundServer({datasetDir,mobileToken:'t'.repeat(64),providerFactory});
    const headers={host:'192.168.1.2:8790',authorization:`Bearer ${'t'.repeat(64)}`};
    const post=(url:string,payload:unknown)=>server.inject({method:'POST',url,headers,payload});
    try {
      const ids=[];
      for(const color of ['red','blue']){
        const bytes=await sharp({create:{width:20,height:20,channels:3,background:color}}).jpeg().toBuffer();
        const response=await server.inject({method:'POST',url:'/upload',headers:{...headers,'content-type':'application/octet-stream'},payload:bytes});
        expect(response.statusCode).toBe(200);ids.push(response.json().photo.id);
      }
      await post('/connect',{key:'test-provider-key-1234567890'});
      await post('/index',{photoIds:[ids[0]]});
      while((await server.inject({url:'/state',headers})).json().indexing)await new Promise(r=>setTimeout(r,5));
      expect(calls).toBe(1);
      await post('/index',{});
      while((await server.inject({url:'/state',headers})).json().indexing)await new Promise(r=>setTimeout(r,5));
      const result=(await post('/search',{query:'person',photoIds:[ids[0]]})).json();
      expect(result.results.map((p:{id:string})=>p.id)).toEqual([ids[0]]);
      expect((await post('/search',{query:'person',photoIds:[]})).statusCode).toBe(400);
      const clarification=(await post('/search',{query:'Mark',context:true,photoIds:[ids[0]]})).json();
      expect(clarification).toMatchObject({needsClarification:true,questions:[{term:'Mark'}]});
      expect((await post('/index',{photoIds:[]})).json().indexing).toBe(false);
      expect(calls).toBe(2);
    }finally{await server.close();}
  });
});
