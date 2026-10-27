import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createPlaygroundServer } from './server';
import { CONFIG, geminiProvider, qwenProvider, validateVerification, verificationInstruction } from './providers';
import { observationInstruction, validateObservations } from './trip-observations';
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
});

describe.each(['gemini', 'qwen'] as const)('%s trip observation transport', name => {
 const ids = ['a'.repeat(64), 'b'.repeat(64)];
 const observation = (id:string) => ({id,scene:'people',activities:['walking'],vibes:['warm light'],aesthetic:75,smilesVisible:true,facesClear:null,evidence:'Visible smiles; one face is partly obscured.'});
 const responseBody = (content:string) => name === 'gemini'
  ? {candidates:[{content:{role:'model',parts:[{text:content}]},finishReason:'STOP'}]}
  : {choices:[{message:{content}}]};
 function connect(fetcher:typeof fetch) {
  if (name === 'gemini') {
   vi.stubGlobal('fetch',fetcher);
   return geminiProvider('offline-observation-contract-key');
  }
  return qwenProvider('offline-observation-contract-key',fetcher);
 }
 it('sends the selected JPEGs with their IDs to the vision model and preserves uncertain observations',async()=>{
  const photos = await Promise.all(ids.map(async(id,index)=>({id,bytes:await sharp({create:{width:20,height:20,channels:3,background:index?'blue':'red'}}).jpeg().toBuffer()})));
  const requests:{url:string;body:any;signal:AbortSignal|null|undefined}[]=[];
  const fetcher = vi.fn(async(url:any,init:any)=>{
   requests.push({url:String(url),body:JSON.parse(init.body),signal:init.signal});
   return new Response(JSON.stringify(responseBody(JSON.stringify({results:ids.map(observation)}))),{headers:{'content-type':'application/json'}});
  });
  const result = validateObservations(await connect(fetcher).observe!(photos),ids);
  expect(result.map(item=>({id:item.id,facesClear:item.facesClear}))).toEqual(ids.map(id=>({id,facesClear:null})));
  expect(requests).toHaveLength(1);
  const request=requests[0];
  expect(request.signal).toBeDefined();
  expect(JSON.stringify(request.body)).not.toContain('offline-observation-contract-key');
  if (name === 'gemini') {
   expect(request.url).toContain(`${CONFIG.gemini.vision}:generateContent`);
   expect(request.body.contents).toEqual([{role:'user',parts:photos.flatMap(photo=>[{text:`Photo ID: ${photo.id}`},{inlineData:{mimeType:'image/jpeg',data:photo.bytes.toString('base64')}}])}]);
   expect(request.body.systemInstruction.parts).toEqual([{text:observationInstruction}]);
   expect(request.body.generationConfig.responseMimeType).toBe('application/json');
  } else {
   expect(request.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
   expect(request.body.model).toBe(CONFIG.qwen.vision);
   expect(request.body.messages).toEqual([{role:'system',content:observationInstruction},{role:'user',content:photos.flatMap(photo=>[{type:'text',text:`Photo ID: ${photo.id}`},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${photo.bytes.toString('base64')}`}}])}]);
   expect(request.body.response_format).toEqual({type:'json_object'});
  }
 });
 it.each([
  ['invalid JSON', '{not-json'],
  ['missing requested photo', JSON.stringify({results:[observation(ids[0])]})],
  ['duplicated photo ID', JSON.stringify({results:[observation(ids[0]),observation(ids[0])]})],
  ['unrequested identity claim', JSON.stringify({results:[{...observation(ids[0]),personName:'Mark'},observation(ids[1])]})],
 ])('rejects %s before observations can be saved',async(_case,content)=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(responseBody(content)),{headers:{'content-type':'application/json'}}));
  const provider=connect(fetcher);
  const observe=async()=>validateObservations(await provider.observe!(ids.map(id=>({id,bytes:Buffer.from('offline-image')}))),ids);
  await expect(observe()).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('propagates quota errors without retrying or inventing observations',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:429,message:'Quota exhausted in offline test',status:'RESOURCE_EXHAUSTED'}}),{status:429,headers:{'content-type':'application/json'}}));
  await expect(connect(fetcher).observe!([{id:ids[0],bytes:Buffer.from('offline-image')}])).rejects.toMatchObject({status:429});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
