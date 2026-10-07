export const DEFAULT_STRICTNESS = 0.5;
// A provisional positive floor, independent of the query's score distribution.
export const BASELINE_SIMILARITY = 0.001;
export function strictnessValue(value) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_STRICTNESS;
}
function eligible(photo, includeUncertain) {
  return Number.isFinite(photo.similarity) && photo.similarity >= BASELINE_SIMILARITY &&
    (!photo.verification || photo.verification.verdict === 'match' || (includeUncertain && photo.verification.verdict === 'uncertain'));
}
export function similarityCutoff(results, position, includeUncertain = false) {
  const scores = results.filter(p => eligible(p,includeUncertain)).map(p => p.similarity).sort((a,b) => b-a);
  if (!scores.length) return Infinity;
  const strictness = strictnessValue(position);
  if (strictness === 0) return BASELINE_SIMILARITY;
  // Percentile-based: midpoint keeps roughly the closest quarter; the strict end
  // keeps the strongest score. Keep equal scores together instead of arbitrary ties.
  const keep = Math.max(1,Math.ceil(scores.length * (1-strictness) ** 2 - 1e-9));
  return scores[keep-1];
}
export function visibleMatches(results, position, includeUncertain = false, distribution = results) {
  // Always use the entire search distribution, including when rendering a page
  // of already-filtered results. Otherwise each render tightens the cutoff again.
  const cutoff = similarityCutoff(distribution,position,includeUncertain);
  return results.filter(p => eligible(p,includeUncertain) && p.similarity >= cutoff);
}
