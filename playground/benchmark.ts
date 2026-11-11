// Retrieval metrics for scripts/compare-providers.ts. `ranked` is the result order for one query and
// `relevant` the photo IDs a person labelled correct before any model saw the photos.
import { z } from 'zod';

export const BenchmarkManifestSchema = z.object({
  photos: z.array(z.object({ id: z.string().min(1), path: z.string().min(1) })).min(2).max(500),
  queries: z.array(z.object({ id: z.string().min(1), query: z.string().min(1).max(1000), relevant: z.array(z.string()) })).min(1).max(200),
}).superRefine((m, ctx) => {
  const ids = new Set(m.photos.map(p => p.id));
  if (ids.size !== m.photos.length) ctx.addIssue({ code: 'custom', message: 'Photo IDs must be unique.' });
  for (const q of m.queries) for (const id of q.relevant) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `Query ${q.id} lists unknown photo ${id}.` });
});
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

// Share of the relevant photos found in the top k. Undefined for queries with nothing relevant.
export function recallAt(ranked: string[], relevant: string[], k: number): number | undefined {
  if (!relevant.length) return undefined;
  const top = new Set(ranked.slice(0, k));
  return relevant.filter(id => top.has(id)).length / relevant.length;
}
// 1 / rank of the first relevant photo; 0 if none appears.
export function reciprocalRank(ranked: string[], relevant: string[]): number | undefined {
  if (!relevant.length) return undefined;
  const set = new Set(relevant);
  const index = ranked.findIndex(id => set.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}
// Normalized discounted cumulative gain: rewards relevant photos placed near the top; 1 is a perfect order.
export function ndcgAt(ranked: string[], relevant: string[], k: number): number | undefined {
  if (!relevant.length) return undefined;
  const set = new Set(relevant);
  const dcg = ranked.slice(0, k).reduce((sum, id, i) => sum + (set.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(k, relevant.length) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return dcg / ideal;
}
export const mean = (values: (number | undefined)[]) => {
  const defined = values.filter((v): v is number => v !== undefined);
  return defined.length ? defined.reduce((a, b) => a + b, 0) / defined.length : undefined;
};
// Visual-check agreement with labels: a 'match' on a relevant photo or a 'mismatch' on an irrelevant one is correct.
// 'uncertain' is counted separately rather than as right or wrong.
export function verdictAgreement(verdicts: { id: string; verdict: string }[], relevant: string[]) {
  const set = new Set(relevant);
  let correct = 0, wrong = 0, uncertain = 0;
  for (const v of verdicts) {
    if (v.verdict === 'uncertain') uncertain++;
    else if ((v.verdict === 'match') === set.has(v.id)) correct++;
    else wrong++;
  }
  return { correct, wrong, uncertain };
}
