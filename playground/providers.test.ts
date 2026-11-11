import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPlaygroundServer } from './server';
import { CONFIG, geminiProvider, modalEndpoint, modalProvider, qwenProvider, validateVerification, verificationInstruction, type Provider } from './providers';
const vec = (n:number,axis=0) => Array.from({length:n},(_,i)=>i===axis?1:0);
afterEach(()=>vi.unstubAllGlobals());
describe('provider isolation and visual checks',()=>{
 it('serializes Gemini image, text, context and verification calls through the real SDK',async()=>{
  const requests:{url:string;body:any}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{
   const body=JSON.parse(init.body);requests.push({url:String(url),body});
   const data=String(url).includes('EmbedContent')||String(url).includes('embedContent')
    ? {embedding:{values:vec(3072)},embeddings:[{values:vec(3072)}]}
    : {candidates:[{content:{role:'model',parts:[{text:JSON.stringify(requests.length===3?{visualQuery:'tennis',references:[]}:{requirements:['grass'],results:[{id:'a',checks:[{status:'pass',evidence:'Visible grass'}]}]})}]},finishReason:'STOP'}]};
   return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  }));
  const provider=geminiProvider('fake-key-for-offline-contract-test');
  expect(await provider.image(Buffer.from('pixels'))).toHaveLength(3072);
  expect(await provider.text('tennis on grass')).toHaveLength(3072);
  expect(await provider.plan!('tennis')).toMatchObject({references:[]});
  await provider.verify!('tennis on grass',[{id:'a',bytes:Buffer.from('pixels')}]);
  expect(requests).toHaveLength(4);
  expect(JSON.stringify(requests[0].body)).toContain('cGl4ZWxz');
  expect(JSON.stringify(requests[0].body)).toContain('3072');
  expect(JSON.stringify(requests[1].body)).toContain('tennis on grass');
  expect(requests[2].url).toContain(CONFIG.gemini.vision);
  expect(JSON.stringify(requests[3].body)).toContain('image/jpeg');
 });
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

 it('sends Modal embeddings to your own endpoint with a bearer token and checks the served model',async()=>{
  const requests:{url:string;init:any;body:any}[]=[];
  let served:string=CONFIG.modal.model;
  const fetcher=(async(url:any,init:any)=>{
   requests.push({url:String(url),init,body:JSON.parse(init.body)});
   return new Response(JSON.stringify({embedding:vec(2048,3),dimensions:2048,model:served}),{status:200});
  }) as typeof fetch;
  const provider=modalProvider('modal-token-long-enough-1234567890','https://me--captured-inference-embedder-web.modal.run/',undefined,fetcher);
  expect(await provider.image(Buffer.from('pixels'))).toEqual(vec(2048,3));
  expect(await provider.text('tennis on grass')).toHaveLength(2048);
  expect(requests[0].url).toBe('https://me--captured-inference-embedder-web.modal.run/embed');
  expect(requests[0].body).toEqual({image:'cGl4ZWxz'});
  expect(requests[1].body).toEqual({text:'tennis on grass'});
  expect(requests[0].init.headers.Authorization).toBe('Bearer modal-token-long-enough-1234567890');
  expect(requests[0].init.redirect).toBe('error');
  expect(JSON.stringify(requests.map(r=>r.body))).not.toContain('modal-token');
  // Without a Gemini key there is no vision model, so the server can say which features are unavailable.
  expect(provider.plan).toBeUndefined();expect(provider.verify).toBeUndefined();expect(provider.identify).toBeUndefined();
  served='some-other-model';
  await expect(provider.text('x')).rejects.toThrow(/expected qwen3-vl-embedding-2b/);
  const failing=modalProvider('t'.repeat(32),'https://x.modal.run',undefined,(async()=>new Response('{}',{status:401})) as typeof fetch);
  await expect(failing.text('x')).rejects.toMatchObject({status:401});
 });
 it('accepts only plain https Modal endpoint URLs and delegates visual checks to the vision provider',()=>{
  expect(modalEndpoint(' https://a.modal.run/ ')).toBe('https://a.modal.run');
  for(const bad of ['http://a.modal.run','https://user:pw@a.modal.run','https://a.modal.run/?x=1','not a url'])expect(()=>modalEndpoint(bad)).toThrow();
  const vision:Provider={image:async()=>[],text:async()=>[],plan:async()=>'plan',verify:async()=>'verify',identify:async()=>'identify'};
  const provider=modalProvider('t'.repeat(32),'https://a.modal.run',vision);
  expect(provider.plan).toBe(vision.plan);expect(provider.verify).toBe(vision.verify);expect(provider.identify).toBe(vision.identify);
 });
 it('connects Modal through the server, keeps a separate index, and explains missing visual checks',async()=>{
  const datasetDir = await mkdtemp(join(tmpdir(),'captured-modal-'));
  const urls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:any)=>{urls.push(String(url));return new Response(JSON.stringify({embedding:vec(2048),dimensions:2048,model:CONFIG.modal.model}),{status:200});}));
  const previous=process.env.MODAL_EMBED_URL; delete process.env.MODAL_EMBED_URL;
  const server = await createPlaygroundServer({datasetDir});
  try {
   const token = (await server.inject({url:'/',headers:{host:'localhost'}})).body.match(/name="playground-session" content="([^"]+)"/)![1];
   const headers = {host:'localhost','x-playground-session':token};
   const post = (url:string,payload:any={})=>server.inject({method:'POST',url,headers,payload});
   const state = async()=>(await server.inject({url:'/state',headers})).json();
   await server.inject({method:'POST',url:'/upload',headers:{...headers,'content-type':'application/octet-stream'},payload:await sharp({create:{width:20,height:20,channels:3,background:'green'}}).png().toBuffer()});
   const key='modal-token-long-enough-1234567890';
   expect((await post('/connect',{key,provider:'modal'})).statusCode).toBe(400);
   expect((await post('/connect',{key,provider:'modal',endpoint:'http://insecure.modal.run'})).statusCode).toBe(400);
   process.env.MODAL_EMBED_URL='https://env--captured.modal.run';
   expect((await post('/connect',{key,provider:'modal'})).statusCode).toBe(200);
   expect((await state()).dimensions).toBe(2048);
   expect((await state()).visionAvailable).toBe(false);
   await post('/index');while((await state()).indexing)await new Promise(r=>setTimeout(r,2));
   expect((await state()).indexed).toBe(1);
   expect(urls[0]).toBe('https://env--captured.modal.run/embed');
   expect((await post('/search',{query:'green'})).statusCode).toBe(200);
   const checked=await post('/search',{query:'green',verify:true});
   expect(checked.statusCode).toBe(400);
   expect(checked.json().message).toContain('Gemini key');
   const photo=(await state()).photos[0];
   expect(JSON.parse(await readFile(join(datasetDir,`${photo.id}.json`),'utf8')).embeddings['qwen3-vl-embedding-2b:2048']).toHaveLength(2048);
  } finally { await server.close(); if(previous===undefined)delete process.env.MODAL_EMBED_URL; else process.env.MODAL_EMBED_URL=previous; }
 });
});
