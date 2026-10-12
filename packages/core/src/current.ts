import { z } from 'zod';

// Contracts for the shared browser/mobile engine. Legacy prototype contracts
// remain in contracts.ts solely for the archived API and its regression tests.
export const COLLECTION_LIMIT = 10000;
export const CLOUD_CONSENT = 'shared-image-search-v1';
export const PhotoId = z.string().regex(/^[a-f0-9]{64}$/);
export const PhotoScope = z.array(PhotoId).max(COLLECTION_LIMIT);
export const PublicPhoto = z.object({ id: PhotoId, name: z.string(), image: z.string(), indexed: z.boolean() });
export const WorkspaceState = z.object({
  protocol: z.literal('captured-v2'), datasetId: z.string().uuid(),
  contextVersion: z.string().default(''),
  photos: z.array(PublicPhoto), configured: z.boolean(), indexing: z.boolean(), searching: z.boolean(),
  indexed: z.number(), total: z.number(), current: z.string(), error: z.string(),
  dimensions: z.number(), model: z.string(), provider: z.enum(['gemini','qwen']), providerLabel: z.string(),
});
export type WorkspaceState = z.infer<typeof WorkspaceState>;
export const MemoryKind = z.enum(['person','place','event','object','preference']);
export const SavedMemory = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), kind: MemoryKind,
  name: z.string(), qualifier: z.string(), aliases: z.array(z.string()), notes: z.string(),
  photoIds: z.array(PhotoId), isMe: z.boolean(), startDate: z.string(), endDate: z.string(),
});
export type SavedMemory = z.infer<typeof SavedMemory>;
export type MemoryDraft = Omit<SavedMemory,'id'|'revision'> & Partial<Pick<SavedMemory,'id'|'revision'>>;
export const Question = z.object({ term: z.string(), kind: MemoryKind, choices: z.array(SavedMemory) });
export type Question = z.infer<typeof Question>;
export const SearchHit = PublicPhoto.extend({ similarity: z.number().finite(), verification: z.object({
  verdict: z.enum(['match','uncertain','mismatch']), explanation: z.string().optional(),
}).optional() });
export const SearchReply = z.union([
  z.object({ needsClarification: z.literal(true), query: z.string(), questions: z.array(Question) }),
  z.object({ results: z.array(SearchHit), cached: z.boolean(), model: z.string(), verified: z.boolean(),
    checked: z.number().optional(), totalCandidates: z.number().optional(),
    contextUsed: z.array(z.object({term:z.string(),id:z.string(),name:z.string(),qualifier:z.string()})),
  }),
]);
export type SearchReply = z.infer<typeof SearchReply>;
export type SearchResult = Extract<SearchReply, {results: unknown}>;
export type SearchRequest = {query: string; context: boolean; verify: boolean; photoIds: string[]; bindings?: Record<string,string>};
