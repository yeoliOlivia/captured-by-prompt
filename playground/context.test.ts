import { describe,it,expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openContext,resolveContext } from './context';
import { createPlaygroundServer } from './server';
import { visibleMatches,thresholdValue } from './search-utils.js';

describe('personal context and search thresholds',()=>{
  it('filters absolute scores without inventing confidence or filling empty results',()=>{
    const photos = [{id:'a',similarity:.8},{id:'b',similarity:.5},{id:'c',similarity:.49},{id:'d',similarity:.9,verification:{verdict:'mismatch'}},{id:'e',similarity:.6,verification:{verdict:'uncertain'}}];
    expect(visibleMatches(photos,.5).map(p=>p.id)).toEqual(['a','b']);
    expect(visibleMatches(photos,.4,true).map(p=>p.id)).toEqual(['a','b','c','e']);
    expect(visibleMatches(photos,.99)).toEqual([]);
    expect(thresholdValue('garbage')).toBe(.5);expect(thresholdValue(null)).toBe(.5);expect(thresholdValue('-1')).toBe(-1);
  });
  it('persists user facts, keeps ambiguous aliases, rejects conflicts, and forgets deleted memories',async()=>{
    const path = join(await mkdtemp(join(tmpdir(),'captured-memory-')),'context.sqlite');
    let store = openContext(path);
    const photo = 'a'.repeat(64), ids = new Set([photo]);
    const college = store.save({kind:'person',name:'Mark',qualifier:'from college',aliases:['Mark Chen'],photoIds:[photo]},ids);
    const soccer = store.save({kind:'person',name:'Mark',qualifier:'from soccer',photoIds:[photo]},ids);
    const plan = {visualQuery:'people',references:[{term:'Mark',kind:'person' as const}]};
    expect(resolveContext(plan,store.list()).questions[0].choices).toHaveLength(2);
    expect(resolveContext(plan,store.list(),{Mark:soccer.id}).resolved[0].memory.id).toBe(soccer.id);
    expect(resolveContext({...plan,references:[{term:'Mark from college',kind:'person'}]},store.list()).resolved[0].memory.id).toBe(college.id);
    expect(resolveContext({...plan,references:[{term:'Mark Chen',kind:'person'}]},store.list()).questions).toEqual([]);
    const me = store.save({kind:'person',name:'Owen',isMe:true,photoIds:[photo]},ids);
    expect(resolveContext({...plan,references:[{term:'me',kind:'person'}]},store.list()).resolved[0].memory.id).toBe(me.id);
    expect(()=>store.save({kind:'person',name:'Someone else',isMe:true,photoIds:[photo]},ids)).toThrow();
    expect(()=>store.save({kind:'person',name:'Mark',photoIds:['b'.repeat(64)]},ids)).toThrow();
    expect(()=>store.save({kind:'event',name:'trip',startDate:'2025-02-30'},ids)).toThrow();
    const edited = store.save({...college,notes:'My friend from college'},ids);
    expect(()=>store.save({...college,notes:'stale edit'},ids)).toThrow(/changed/);
    expect(()=>store.remove(college.id,college.revision)).toThrow(/changed/);
    store.close(); store = openContext(path);
    expect(store.list().find(m=>m.id===college.id)?.notes).toBe('My friend from college');
    store.remove(edited.id,edited.revision);
    expect(resolveContext({...plan,references:[{term:'Mark Chen',kind:'person'}]},store.list()).questions).toHaveLength(1);
    store.close();
  });
  it('clarifies before embedding, resumes with relevant facts, verifies references, and invalidates edited context',async()=>{
    const datasetDir = await mkdtemp(join(tmpdir(),'captured-context-api-'));
    let plans = 0, texts = 0, checks = 0;
    const received:any[]=[];
    const server = await createPlaygroundServer({datasetDir,providerFactory:()=>({
      image:async()=>Array.from({length:3072},(_,i)=>i===0?1:0),
      text:async()=>{texts++;return Array.from({length:3072},(_,i)=>i===0?1:0);},
      plan:async query=>{plans++;return {visualQuery:'people',references:query==='a dog'?[]:[{term:'Mark',kind:'person'}]};},
      verify:async(query,images,context)=>{checks++;received.push(context);return {requirements:[query],results:images.map(p=>({id:p.id,checks:[{status:'pass',evidence:'User-confirmed reference'}]}))};},
    })});
    try {
      const token = (await server.inject({url:'/',headers:{host:'localhost'}})).body.match(/name="playground-session" content="([^"]+)"/)![1];
      const headers = {host:'localhost','x-playground-session':token};
      const post=(url:string,payload:any={})=>server.inject({method:'POST',url,headers,payload});
      const state=async()=>(await server.inject({url:'/state',headers})).json();
      const bytes=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).png().toBuffer();
      const photo=(await server.inject({method:'POST',url:'/upload',headers:{...headers,'content-type':'application/octet-stream'},payload:bytes})).json().photo;
      await post('/connect',{key:'test-only-key-long-enough'});await post('/index');
      while((await state()).indexing) await new Promise(r=>setTimeout(r,2));
      let result=(await post('/search',{query:'Mark',context:true})).json();
      expect(result.needsClarification).toBe(true);expect(texts).toBe(0);expect(checks).toBe(0);
      const memory=(await post('/context/save',{kind:'person',name:'Mark',photoIds:[photo.id]})).json().memory;
      await post('/context/save',{kind:'place',name:'Private unrelated place',notes:'This must not leave the store.'});
      result=(await post('/search',{query:'Mark',context:true})).json();
      expect(result.contextUsed[0].id).toBe(memory.id);expect(result.verified).toBe(true);expect(plans).toBe(2);
      expect(received[0].references).toHaveLength(1);
      expect(received[0].facts.candidates[0].confirmedEntityIds).toEqual([memory.id]);
      expect(JSON.stringify(received)).not.toContain('Private unrelated place');
      await post('/search',{query:'Mark',context:true});expect(checks).toBe(1);
      const edited=(await post('/context/save',{...memory,notes:'From college'})).json().memory;
      await post('/search',{query:'Mark',context:true});expect(checks).toBe(2);
      expect(received[1].facts.entities[0].notes).toBe('From college');
      expect((await post('/context/save',{...memory,notes:'stale'})).statusCode).toBe(400);
      const other=(await post('/context/save',{kind:'person',name:'Mark',qualifier:'from soccer',photoIds:[photo.id]})).json().memory;
      result=(await post('/search',{query:'Mark',context:true})).json();expect(result.questions[0].choices).toHaveLength(2);
      result=(await post('/search',{query:'Mark',context:true,bindings:{Mark:other.id}})).json();expect(result.contextUsed[0].id).toBe(other.id);
      expect((await server.inject({method:'POST',url:'/context/delete',headers:{host:'localhost'},payload:{id:edited.id,revision:edited.revision}})).statusCode).toBe(403);
      await post('/context/delete',{id:edited.id,revision:edited.revision});
      const before=checks;await post('/search',{query:'a dog',context:true});expect(checks).toBe(before);
    } finally {await server.close();}
    const restarted=await createPlaygroundServer({datasetDir});
    const data=(await restarted.inject({url:'/context',headers:{host:'localhost'}})).json();
    expect(data.memories).toHaveLength(2);expect(JSON.stringify(data)).not.toContain('test-only-key');
    await restarted.close();
  });
});
