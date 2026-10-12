import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Photo } from '@captured/core';
import { CLOUD_CONSENT, type WorkspaceState, type SearchResult, type Question, type SavedMemory, type MemoryDraft } from '@captured/core/current';
import { strictnessValue, visibleMatches } from '@captured/core/strictness';
import nativePhotos from '../modules/captured-photos';
import { runPhotoAction, selectionSnapshot, type ActionPhoto, type PhotoAction } from './photo-actions';
import { store } from './store';
import { api } from './api';
import { clarifiedDraft } from './context-draft';
import { selectPhotos, previewBase64, deleteLocalPhoto, deleteAllLocalPhotos } from './photos';

export type MobilePhoto = Photo & {remoteId?:string; indexed:boolean};
type Activity = 'selecting'|'uploading'|'searching'|'saving'|null;
interface Library {
  selection:ActionPhoto[]; photosActionsAvailable:boolean;
  setSelection(photos:readonly ActionPhoto[]):void; toggleSelection(photo:ActionPhoto):void; clearSelection():void;
  photosAction(action:PhotoAction,snapshot:readonly ActionPhoto[],albumName?:string):Promise<boolean>;
  ready:boolean; photos:MobilePhoto[]; workspace:WorkspaceState|null; activity:Activity; notice:string; consent:boolean;
  results:SearchResult|null; searchingView:boolean; matches:MobilePhoto[]; query:string; questions:Question[];
  memories:SavedMemory[]; editingQuestion:Question|null; strictness:number; includeUncertain:boolean;
  useContext:boolean; verify:boolean;
  setNotice(text:string):void; setStrictness(value:number):void; setIncludeUncertain(value:boolean):void;
  setUseContext(value:boolean):void; setVerify(value:boolean):void; setEditingQuestion(value:Question|null):void;
  refresh():Promise<void>; connectionChanged():Promise<void>; acceptConsent():Promise<void>; revokeConsent():Promise<void>;
  add():Promise<void>; index():Promise<void>; pause():Promise<void>; search(query:string,bindings?:Record<string,string>):Promise<void>;
  bind(question:Question,memory:SavedMemory):Promise<void>; saveMemory(draft:MemoryDraft):Promise<boolean>; deleteMemory(memory:SavedMemory):Promise<void>;
  browse():void; remove(id:string):Promise<void>; clear():Promise<void>;
}
const Context = createContext<Library|null>(null);
export function LibraryProvider({children}:{children:ReactNode}) {
  const [selection,setSelectionState]=useState<ActionPhoto[]>([]);
  const [local,setLocal] = useState<Photo[]>([]), [links,setLinks] = useState<Record<string,string>>({});
  const [workspace,setWorkspace] = useState<WorkspaceState|null>(null), [ready,setReady] = useState(false);
  const [activity,setActivity] = useState<Activity>(null), [notice,setNotice] = useState(''), [consent,setConsent] = useState(false);
  const [results,setResults] = useState<SearchResult|null>(null), [searchingView,setSearchingView] = useState(false);
  const [query,setQuery] = useState(''), [questions,setQuestions] = useState<Question[]>([]), [memories,setMemories] = useState<SavedMemory[]>([]);
  const [editingQuestion,setEditingQuestion] = useState<Question|null>(null);
  const [strictness,setStrictnessState] = useState(.5), [includeUncertain,setIncludeUncertain] = useState(false);
  const [useContext,setUseContextState] = useState(true), [verify,setVerifyState] = useState(false);
  const busy = useRef(false), refreshVersion = useRef(0), identity = useRef(''), bindings = useRef<Record<string,string>>({});
  function clearResults() {setSelectionState([]);setResults(null); setQuestions([]); bindings.current={}; setEditingQuestion(null);}
  async function refresh() {
    const version = ++refreshVersion.current;
    const currentLocal = await store.list();
    if(version !== refreshVersion.current) return;
    setLocal(currentLocal);
    const state = await api.state();
    const [mapped,context] = await Promise.all([store.links(state.datasetId),api.memories()]);
    if(version !== refreshVersion.current) return;
    const nextIdentity = `${state.datasetId}:${state.provider}:${state.model}:${state.dimensions}:${state.contextVersion}`;
    if(identity.current && identity.current !== nextIdentity) clearResults();
    identity.current = nextIdentity;
    setWorkspace(state); setLinks(mapped); setMemories(context.memories);
    if(state.error) setNotice(state.error);
  }
  useEffect(()=>{
    Promise.all([store.list(),store.setting('consent'),store.setting('search-strictness-v1')]).then(([photos,accepted,strict])=>{
      setLocal(photos);setConsent(accepted===CLOUD_CONSENT);setStrictnessState(strictnessValue(strict));
    }).catch(()=>setNotice('Could not load your collection.')).finally(()=>setReady(true));
    refresh().catch(()=>{});
    const sub=AppState.addEventListener('change',state=>{if(state==='active' && !busy.current) refresh().catch(()=>{});});
    return ()=>{sub.remove();refreshVersion.current++;};
  },[]);
  useEffect(()=>{
    if(!workspace?.indexing) return;
    const timer=setInterval(()=>{if(!busy.current && AppState.currentState==='active') refresh().catch(()=>setNotice('Connection lost. Reconnect to check analysis progress.'));},2000);
    return ()=>clearInterval(timer);
  },[workspace?.indexing]);
  async function perform(kind:Activity,action:()=>Promise<void>) {
    if(busy.current) return false;
    busy.current=true;setActivity(kind);setNotice('');
    try {await action();return true;}
    catch(e) {setNotice(e instanceof Error ? e.message : 'Please try again.');return false;}
    finally {busy.current=false;setActivity(null);}
  }
  const stateById=new Map(workspace?.photos.map(p=>[p.id,p]));
  const photos:MobilePhoto[]=local.map(p=>({...p,remoteId:links[p.id],indexed:!!stateById.get(links[p.id]??'')?.indexed}));
  const hitIds=new Map(results ? visibleMatches(results.results,strictness,includeUncertain).map((p,i)=>[p.id,i]) : []);
  const matches=photos.filter(p=>p.remoteId && hitIds.has(p.remoteId)).sort((a,b)=>hitIds.get(a.remoteId!)!-hitIds.get(b.remoteId!)!);
  async function runSearch(text:string,nextBindings:Record<string,string>={}) {
    if(!consent) throw new Error('Review cloud analysis before searching.');
    setSearchingView(true);setResults(null);setQuestions([]);setQuery(text);
    await refresh();
    bindings.current=nextBindings;
    const state=await api.state(), mapped=await store.links(state.datasetId), currentPhotos=await store.list();
    const available=new Set(state.photos.filter(p=>p.indexed).map(p=>p.id));
    const photoIds=[...new Set(currentPhotos.map(p=>mapped[p.id]).filter((id):id is string=>!!id && available.has(id)))];
    if(!photoIds.length) throw new Error('Analyze selected photos first.');
    const result=await api.search({query:text,context:useContext,verify,photoIds,bindings:nextBindings});
    if('needsClarification' in result) {setQuestions(result.questions);setNotice('A little context is needed before searching.');}
    else {setResults(result);setNotice(result.verified ? `Showing checked matches from ${result.checked} candidates. Other matches may exist.` : 'Image similarity search. Broaden the slider to see more.');}
  }
  const value:Library={selection,photosActionsAvailable:!!nativePhotos,
    setSelection(photos){if(!busy.current)setSelectionState(selectionSnapshot(photos));},
    toggleSelection(photo){if(!busy.current)setSelectionState(selected=>selected.some(p=>p.id===photo.id)?selected.filter(p=>p.id!==photo.id):[...selected,...selectionSnapshot([photo])]);},
    clearSelection(){if(!busy.current)setSelectionState([]);},
    async photosAction(action,snapshot,albumName){return perform('saving',async()=>{
      const result=await runPhotoAction(nativePhotos,action,snapshot,albumName);
      if(!result.completed){setNotice('Sharing cancelled. Your selection is unchanged.');return;}
      if(action==='delete') {
        // PhotoKit has already confirmed deletion. Never run this cleanup before the native result.
        try {
          const removed=await store.removeByAssets(result.assetIds);
          let filesKept=0;
          for(const photo of removed){try{deleteLocalPhoto(photo);}catch{filesKept++;}}
          setLocal(await store.list());clearResults();
          setNotice(`Deleted ${result.assetIds.length} originals from Photos and removed them from this app. Mac workspace copies remain.${filesKept?' Some unused phone copy files could not be cleaned up.':''}`);
        } catch {setSelectionState([]);setResults(null);setNotice('Originals were deleted from Photos, but app-copy cleanup failed. Remove those phone copies from the collection manually. Mac workspace copies remain.');}
      } else {
        const message={favorite:'Added to Favorites',unfavorite:'Removed from Favorites',album:'Saved to album',share:'Sharing finished'}[action];
        setNotice(`${message} · ${result.assetIds.length} photo${result.assetIds.length===1?'':'s'}.`);
      }
    });},
    ready,photos,workspace,activity,notice,consent,results,searchingView,matches,query,questions,memories,editingQuestion,strictness,includeUncertain,useContext,verify,
    setNotice,setEditingQuestion,setIncludeUncertain,
    setUseContext(v){setUseContextState(v);clearResults();},setVerify(v){setVerifyState(v);clearResults();},
    setStrictness(v){setStrictnessState(strictnessValue(v));void store.setSetting('search-strictness-v1',String(v)).catch(()=>setNotice('Could not save the filter preference.'));},
    refresh,
    async connectionChanged(){refreshVersion.current++;identity.current='';setWorkspace(null);setLinks({});setMemories([]);clearResults();await refresh();},
    async acceptConsent(){await store.setSetting('consent',CLOUD_CONSENT);setConsent(true);},
    async revokeConsent(){await store.setSetting('consent','');setConsent(false);setNotice('Cloud analysis is off. Existing copies remain on this phone and in the workspace.');},
    async add(){await perform('selecting',async()=>{const n=await selectPhotos();setLocal(await store.list());if(n){clearResults();setNotice(`${n} photos selected. Analyze to upload previews to your workspace.`);}});},
    async index(){await perform('uploading',async()=>{
      if(!consent) throw new Error('Review cloud analysis first.');
      clearResults();
      const state=await api.state();
      if(!state.configured) throw new Error('Connect Gemini or Qwen in the browser workspace first.');
      if(state.indexing) throw new Error('Analysis is already running. Refresh or pause it first.');
      const mapped=await store.links(state.datasetId), existing=new Set(state.photos.map(p=>p.id));
      const selected=await store.list(), ids:string[]=[];
      for(const [i,photo] of selected.entries()) {
        let id=mapped[photo.id];
        if(!id || !existing.has(id)) {
          setNotice(`Uploading preview ${i+1} of ${selected.length}…`);
          const result=await api.upload(await previewBase64(photo));id=result.photo.id;
          await store.link(photo.id,state.datasetId,id);
        }
        ids.push(id);
      }
      const latest=await api.state();
      if(latest.datasetId!==state.datasetId) throw new Error('Workspace changed during upload. Reconnect and try again.');
      await api.index([...new Set(ids)]);await refresh();setNotice('Analysis started. Completed photos are saved in your workspace.');
    });},
    async pause(){await perform('saving',async()=>{await api.pause();await refresh();setNotice('Pausing after the current photo finishes.');});},
    async search(text,bound={}){await perform('searching',()=>runSearch(text,bound));},
    async bind(question,memory){await perform('searching',async()=>{
      if(!question.choices.length) await api.saveMemory({...memory,isMe:question.term==='me' ? true : memory.isMe,aliases:[...new Set([...memory.aliases,question.term])]});
      const bound={...bindings.current,[question.term]:memory.id};await runSearch(query,bound);
    });},
    async saveMemory(draft){return perform('saving',async()=>{
      const question=editingQuestion;
      const {memory}=await api.saveMemory(clarifiedDraft(draft,question));
      setMemories((await api.memories()).memories);setResults(null);setEditingQuestion(null);
      if(question) await runSearch(query,{...bindings.current,[question.term]:memory.id});
      else setNotice('Context saved. Run your search again to use the update.');
    });},
    async deleteMemory(memory){await perform('saving',async()=>{await api.deleteMemory(memory.id,memory.revision);clearResults();setMemories((await api.memories()).memories);setNotice('Context deleted.');});},
    browse(){if(busy.current)return;clearResults();setSearchingView(false);setQuery('');setNotice('');},
    async remove(id){await perform('saving',async()=>{const photo=await store.get(id);if(photo)deleteLocalPhoto(photo);await store.remove(id);setLocal(await store.list());clearResults();setNotice('Removed from this phone’s app collection. Originals and workspace copies remain.');});},
    async clear(){await perform('saving',async()=>{deleteAllLocalPhotos();await store.clear();setLocal([]);setLinks({});clearResults();setNotice('Phone copies removed. Photos originals and workspace copies/context remain.');});},
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLibrary(){const value=useContext(Context);if(!value)throw new Error('LibraryProvider missing');return value;}
