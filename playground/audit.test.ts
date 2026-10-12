import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPlaygroundServer } from './server';
import { vector } from './providers';
import { normalize } from './context';

describe('audit regressions',()=>{
  it('normalizes finite vectors even when their unscaled norm overflows',()=>{
    const result=vector([Number.MAX_VALUE,Number.MAX_VALUE],2);
    expect(Math.hypot(...result)).toBeCloseTo(1);
    expect(()=>vector([0,0],2)).toThrow();
    expect(()=>vector([Infinity,1],2)).toThrow();
  });
  it('normalizes surrounding whitespace before articles in personal aliases',()=>{
    expect(normalize('  The Japan trip  ')).toBe(normalize('Japan trip'));
  });
  it('keeps good photos usable after a damaged cache, and retries only unfinished analysis',async()=>{
    const datasetDir=await mkdtemp(join(tmpdir(),'captured-audit-'));
    let calls=0, fail=true;
    const vec=Array.from({length:3072},(_,i)=>i===0?1:0);
    const factory=()=>({image:async()=>{calls++;if(fail&&calls===2)throw Object.assign(new Error('private provider error'),{status:429});return vec;},text:async()=>vec});
    let server=await createPlaygroundServer({datasetDir,providerFactory:factory});
    const headers={host:'localhost'};
    const state=async()=>(await server.inject({url:'/state',headers})).json();
    let session='';
    const connectPage=async()=>{session=(await server.inject({url:'/',headers})).body.match(/name="playground-session" content="([^"]+)"/)![1];};
    const post=(url:string,payload:unknown={})=>server.inject({method:'POST',url,headers:{...headers,'x-playground-session':session},payload});
    const finish=async()=>{for(let i=0;i<200;i++){if(!(await state()).indexing)return;await new Promise(r=>setTimeout(r,5));}throw new Error('Indexing did not finish');};
    try{
      await connectPage();
      for(const color of ['red','blue'])await server.inject({method:'POST',url:'/upload',headers:{...headers,'x-playground-session':session,'content-type':'application/octet-stream'},payload:await sharp({create:{width:20,height:20,channels:3,background:color}}).png().toBuffer()});
      await post('/connect',{key:'test-only-key-long-enough'});await post('/index');await finish();
      expect(await state()).toMatchObject({indexed:1,error:expect.stringContaining('quota')});
      expect(JSON.stringify(await state())).not.toContain('private provider error');
      fail=false;await post('/index');await finish();expect(calls).toBe(3);expect((await state()).indexed).toBe(2);
      const [photo]=(await state()).photos;
      await server.close();
      const record=JSON.parse(await readFile(join(datasetDir,photo.id+'.json'),'utf8'));
      record.embeddings['gemini-embedding-2:3072']=[0];
      await writeFile(join(datasetDir,photo.id+'.json'),JSON.stringify(record));
      await writeFile(join(datasetDir,'f'.repeat(64)+'.json'),'{broken');
      server=await createPlaygroundServer({datasetDir,providerFactory:factory});
      expect(await state()).toMatchObject({total:2,indexed:1,error:expect.stringContaining('cache')});
      await connectPage();await post('/connect',{key:'test-only-key-long-enough'});await post('/index');await finish();expect(calls).toBe(4);
      expect(await readFile(join(datasetDir,'f'.repeat(64)+'.json'),'utf8')).toBe('{broken');
    }finally{await server.close();await rm(datasetDir,{recursive:true,force:true});}
  });
});
