import { EMBEDDING_MODEL, type Photo, type PreparedQuery, type RankResponse } from './contracts';

export interface SearchHit { photo: Photo; score: number; }

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

const stop = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'and', 'with', 'photo', 'photos', 'find', 'me', 'my', 'that', 'this', 'is', 'it']);
function words(text: string): Set<string> {
  return new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => !stop.has(w)));
}

export function retrieve(photos: Photo[], query: PreparedQuery): SearchHit[] {
  const tokens = words(query.text);
  const scored = photos.filter(p => {
    if (p.status !== 'ready' || !p.analysis || p.analysis.embeddingModel !== EMBEDDING_MODEL) return false;
    const date = p.capturedAt?.slice(0, 10);
    if (query.dates.from && (!date || date < query.dates.from)) return false;
    if (query.dates.to && (!date || date > query.dates.to)) return false;
    return true;
  }).map(photo => {
    const text = words(`${photo.analysis!.description} ${photo.analysis!.visibleText}`);
    const matches = [...tokens].filter(t => text.has(t)).length;
    return { photo, visual: cosine(photo.analysis!.embedding, query.embedding), lexical: tokens.size ? matches / tokens.size : 0 };
  });
  const visual = [...scored].sort((a, b) => b.visual - a.visual);
  const lexical = [...scored].filter(x => x.lexical > 0).sort((a, b) => b.lexical - a.lexical);
  return scored.map(({ photo }) => ({
    photo,
    score: 1 / (60 + visual.findIndex(x => x.photo.id === photo.id) + 1)
      + (lexical.some(x => x.photo.id === photo.id) ? 1 / (60 + lexical.findIndex(x => x.photo.id === photo.id) + 1) : 0),
  })).sort((a, b) => b.score - a.score);
}

// A provider may only reorder candidates supplied by the client; it may never introduce photos.
export function applyRanking(hits: SearchHit[], response: RankResponse): SearchHit[] {
  if (response.mode !== 'jev') return hits;
  const scores = new Map(response.results.map(x => [x.id, x.score]));
  if (scores.size !== hits.length || hits.some(h => !scores.has(h.photo.id))) return hits;
  return hits.map(h => ({ ...h, score: scores.get(h.photo.id)! })).sort((a, b) => b.score - a.score);
}
