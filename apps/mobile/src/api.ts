import { z } from 'zod';
import { WorkspaceState, PublicPhoto, SavedMemory, SearchReply, type MemoryDraft, type SearchRequest } from '@captured/core/current';
import { store } from './store';

export async function callApi<T>(path: string, schema: z.ZodType<T>, body?: unknown, raw = false): Promise<T> {
  const url = await store.setting('server-url');
  const token = await store.token();
  if (!url || token.length < 32) throw new Error('Open Settings to connect your workspace first.');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),180000);
  try {
    const response = await fetch(`${url.replace(/\/$/,'')}${path}`,{
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization:`Bearer ${token}`,...(body === undefined ? {} : {'Content-Type':raw ? 'application/octet-stream' : 'application/json'})},
      body: body === undefined ? undefined : raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body), signal:controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.message === 'string' ? data.message : 'The workspace could not complete this request.');
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error('This server uses an incompatible API. Update the repo and run npm run dev:lan.');
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The request timed out. Completed work is saved; refresh before retrying.');
    throw error;
  } finally {clearTimeout(timer);}
}
const ok = z.object({}).passthrough();
export const api = {
  state: () => callApi('/state',WorkspaceState),
  upload: (base64:string) => callApi('/upload',z.object({photo:PublicPhoto}),Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),true),
  index: (photoIds:string[]) => callApi('/index',ok,{photoIds}),
  pause: () => callApi('/pause',ok,{}),
  search: (input:SearchRequest) => callApi('/search',SearchReply,input),
  memories: () => callApi('/context',z.object({memories:z.array(SavedMemory)})),
  saveMemory: (input:MemoryDraft) => callApi('/context/save',z.object({memory:SavedMemory}),input),
  deleteMemory: (id:string,revision:number) => callApi('/context/delete',ok,{id,revision}),
};
