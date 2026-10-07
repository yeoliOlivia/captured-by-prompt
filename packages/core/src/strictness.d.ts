export const DEFAULT_STRICTNESS: number;
export const BASELINE_SIMILARITY: number;
export function strictnessValue(value: unknown): number;
export interface Scored { similarity: number; verification?: { verdict: string } }
export function similarityCutoff(results: Scored[], position: number, includeUncertain?: boolean): number;
export function visibleMatches<T extends Scored>(results: T[], position: number, includeUncertain?: boolean, distribution?: T[]): T[];
