import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPlaygroundServer } from './server';
import { CONFIG, qwenProvider, validateVerification, verificationInstruction } from './providers';
const vec = (n:number,axis=0) => Array.from({length:n},(_,i)=>i===axis?1:0);
describe('provider isolation and visual checks',()=>{
 it('preserves indexes, verifies all conditions, caches checks and rejects incomplete assessments',async()=>{
  const datasetDir = await mkdtemp(join(tmpdir(),'captured-providers-'));
  const calls = {gemini:0,qwen:0,verification:0};
  let malformed = false;
  const server = await createPlaygroundServer({datasetDir,providerFactory:(_,name)=>({
   image:async()=>{calls[name]++;return vec(CONFIG[name].dimensions);},
   text:async()=>vec(CONFIG[name].dimensions),
   verify:async(_,images)=>{calls.verification++;return {requirements:['Tennis is being played','Playing surface is grass','No dog is visible'],results:images.slice(malformed?1:0).map((p,i)=>({id:p.id,checks:[{status:'pass',evidence:'Racket and ball visible'},{status:i===0?'fail':'pass',evidence:i===0?'Hard court':'Visible grass'},{status:'pass',evidence:'Unobstructed scene without a visible dog'}]}))};},
  })});
  try {
   const token = (await server.inject({url:'/',headers:{host:'localhost'}})).body.match(/name="playground-session" content="([^"]+)"/)![1];
   const headers = {host:'localhost','x-playground-session':token};
   const post = (url:string,payload:any={})=>server.inject({method:'POST',url,headers,payload});
   const state = async()=>(await server.inject({url:'/state',headers})).json();
   for(const color of ['red','blue'])await server.inject({method:'POST',url:'/upload',headers:{...headers,'content-type':'application/octet-stream'},payload:await sharp({create:{width:20,height:20,channels:3,background:color}}).png().toBuffer()});
   const index = async()=>{await post('/index');while((await state()).indexing)await new Promise(r=>setTimeout(r,2));};
   await post('/connect',{key:'test-key-long-enough-123',provider:'gemini'});await index();
   const original = (await post('/search',{query:'tennis on grass and no dog'})).json();
   const checked = (await post('/search',{query:'tennis on grass and no dog',verify:true})).json();
   expect(checked.results[0].id).toBe(original.results[1].id);
   expect(checked.results.map((p:any)=>p.verification.verdict)).toEqual(['match','mismatch']);
   expect(checked.results[0].verification.checks).toHaveLength(3);
   expect((await post('/search',{query:'tennis on grass and no dog',verify:true})).json().verificationCached).toBe(true);
   expect(calls.verification).toBe(1);
   malformed=true;
   expect((await post('/search',{query:'different query',verify:true})).statusCode).toBe(502);
   await post('/connect',{key:'qwen-test-key-long-enough',provider:'qwen'});
   expect((await state()).indexed).toBe(0);
   expect((await post('/search',{query:'test'})).statusCode).toBe(400);
   await index();expect((await state()).indexed).toBe(2);
   expect((await state()).dimensions).toBe(2560);
   await post('/connect',{key:'test-key-long-enough-123',provider:'gemini'});
   expect((await state()).indexed).toBe(2);await index();expect(calls.gemini).toBe(2);
   const photo = (await state()).photos[0];
   const record = JSON.parse(await readFile(join(datasetDir,`${photo.id}.json`),'utf8'));
   expect(record.embeddings['gemini-embedding-2:3072']).toHaveLength(3072);
   expect(record.embeddings['qwen3-vl-embedding:2560']).toHaveLength(2560);
  } finally {await server.close();}
  const restarted = await createPlaygroundServer({datasetDir});
  expect((await restarted.inject({url:'/state',headers:{host:'localhost'}})).json().indexed).toBe(2);
  await restarted.close();
 });
 it('validates complete checklists and treats uncertainty as uncertainty',()=>{
  const r = {requirements:['A or B','No dog'],results:[{id:'1',checks:[{status:'pass',evidence:'A visible'},{status:'uncertain',evidence:'Scene partly occluded'}]}]};
  expect(validateVerification(r,['1']).results[0].verdict).toBe('uncertain');
  expect(()=>validateVerification({...r,results:[...r.results,...r.results]},['1'])).toThrow();
  expect(()=>validateVerification({...r,requirements:['one']},['1'])).toThrow();
  expect(verificationInstruction).toContain('OR expression grouped');
 });
 it('sends raw images and queries to Qwen with separate embedding and vision requests',async()=>{
  const requests:any[]=[];
  const fetcher = (async(url:any,options:any)=>{
   requests.push({url,body:JSON.parse(options.body)});
   return new Response(JSON.stringify(String(url).includes('embeddings/')?{output:{embeddings:[{embedding:vec(2560)}]}}:{choices:[{message:{content:JSON.stringify({requirements:['grass'],results:[{id:'a',checks:[{status:'pass',evidence:'grass'}]}]})}}]}),{status:200});
  }) as typeof fetch;
  const provider=qwenProvider('private-key',fetcher);
  await provider.image(Buffer.from('pixels'));await provider.text('tennis and grass');await provider.verify!('tennis and grass',[{id:'a',bytes:Buffer.from('pixels')}]);
  expect(requests[0].body.input.contents).toEqual([{image:'data:image/jpeg;base64,cGl4ZWxz'}]);
  expect(requests[0].body.parameters.dimension).toBe(2560);
  expect(requests[1].body.input.contents).toEqual([{text:'tennis and grass'}]);
  expect(requests[2].body.model).toBe('qwen3-vl-plus');
  expect(JSON.stringify(requests)).not.toContain('private-key');
 });
});
