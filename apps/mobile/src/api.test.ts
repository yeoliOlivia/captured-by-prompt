import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const settings=vi.hoisted(()=>new Map<string,string>());
vi.mock('./store',()=>({store:{setting:async(key:string)=>settings.get(key)??null,token:async()=> 'a'.repeat(64)}}));
beforeEach(()=>{settings.clear();settings.set('server-url','http://192.168.1.2:8790');});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const request={query:'tennis on grass',context:true,verify:false,photoIds:['b'.repeat(64)]};
describe('shared mobile API',()=>{
  it('allows a multi-stage personal search to outlast the shorter upload timeout',async()=>{
    vi.useFakeTimers();
    let signal:AbortSignal|undefined;
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
      signal=init.signal;
      await new Promise(r=>setTimeout(r,210000));
      return new Response(JSON.stringify({results:[],cached:false,model:'gemini-embedding-2',verified:true,contextUsed:[]}));
    }));
    const {api}=await import('./api');const pending=api.search(request);
    await vi.advanceTimersByTimeAsync(210000);
    expect(signal?.aborted).toBe(false);
    expect(await pending).toMatchObject({verified:true});
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the same search route and passes explicit photo scope and context settings',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({results:[],cached:false,model:'gemini-embedding-2',verified:false,contextUsed:[]})));
    vi.stubGlobal('fetch',fetch);const {api}=await import('./api');
    expect(await api.search(request)).toMatchObject({results:[]});
    expect(fetch).toHaveBeenCalledWith('http://192.168.1.2:8790/search',expect.objectContaining({headers:expect.objectContaining({Authorization:`Bearer ${'a'.repeat(64)}`}),body:JSON.stringify(request)}));
  });
  it('preserves clarification instead of presenting it as empty results',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({needsClarification:true,query:'Mark',questions:[{term:'Mark',kind:'person',choices:[]}]}))));
    const {api}=await import('./api');expect(await api.search(request)).toMatchObject({needsClarification:true});
  });
  it('rejects legacy server state and malformed search replies',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({mode:'free-only',geminiReady:true}))));
    const {api}=await import('./api');await expect(api.state()).rejects.toThrow('incompatible API');await expect(api.search(request)).rejects.toThrow('incompatible API');
  });
  it('surfaces model failures without issuing a second request or inventing results',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({message:'Provider quota reached.'}),{status:502}));vi.stubGlobal('fetch',fetch);
    const {api}=await import('./api');await expect(api.search(request)).rejects.toThrow('Provider quota');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses requests before workspace setup',async()=>{
    settings.clear();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {api}=await import('./api');await expect(api.state()).rejects.toThrow('Settings');expect(fetch).not.toHaveBeenCalled();
  });
});
