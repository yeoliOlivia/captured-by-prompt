export const DEFAULT_SIMILARITY = 0.5;
export function thresholdValue(value) {
  const n = Number(value);
  return value !== null && value !== '' && Number.isFinite(n) && n >= -1 && n <= 1 ? n : DEFAULT_SIMILARITY;
}
export function visibleMatches(results, threshold, includeUncertain = false) {
  return results.filter(p => Number.isFinite(p.similarity) && p.similarity >= threshold &&
    (!p.verification || p.verification.verdict === 'match' || (includeUncertain && p.verification.verdict === 'uncertain')));
}
