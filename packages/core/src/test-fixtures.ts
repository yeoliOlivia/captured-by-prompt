import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, VISION_MODEL, type Photo, type Analysis, type PreparedQuery } from './contracts';

// Synthetic vectors for deterministic software tests only. These are not model outputs.
export function vector(index = 0) { return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === index ? 1 : 0); }
export function analysis(description = 'A red umbrella on a beach', index = 0): Analysis {
  return { description, visibleText: '', embedding: vector(index), embeddingModel: EMBEDDING_MODEL, visionModel: VISION_MODEL, usage: { inputTokens: 0, outputTokens: 0 } };
}
export function photo(id = 'one', overrides: Partial<Photo> = {}): Photo {
  return { id, assetId: id, uri: 'file:///test.jpg', width: 100, height: 100, capturedAt: '2026-07-04', status: 'ready', analysis: analysis(), error: null, addedAt: '2026-09-22T12:00:00Z', ...overrides };
}
export function query(text = 'red umbrella'): PreparedQuery { return { text, dates: { from: null, to: null }, embedding: vector(), embeddingModel: EMBEDDING_MODEL, usage: { inputTokens: 0, outputTokens: 0 } }; }
