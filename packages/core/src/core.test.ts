import { describe, expect, it, vi } from 'vitest';
import { AnalysisRequestSchema, CONSENT_VERSION, QueryRequestSchema, ServiceError, assertCapacity, exifDate, queryCacheKey, type Photo } from './contracts';
import { applyRanking, cosine, retrieve } from './search';
import { indexCollection, type IndexStore } from './indexer';
import { photo, analysis, query } from './test-fixtures';

describe('selection and requests', () => {
  it('allows 30 and rejects the 31st photo', () => { expect(() => assertCapacity(29, 1)).not.toThrow(); expect(() => assertCapacity(30, 1)).toThrow(); });
  it('requires the current consent version', () => { expect(AnalysisRequestSchema.safeParse({ imageBase64: 'a'.repeat(20) }).success).toBe(false); });
  it('bounds history and includes context/date in cache identities', () => {
    const req = { consentVersion: CONSENT_VERSION, prompt: 'at night', history: ['green booths'], today: '2026-09-22' };
    expect(QueryRequestSchema.safeParse(req).success).toBe(true);
    expect(queryCacheKey(req)).not.toBe(queryCacheKey({ ...req, history: [] }));
    expect(QueryRequestSchema.safeParse({ ...req, history: Array(9).fill('x') }).success).toBe(false);
  });
  it('does not invent capture dates', () => { expect(exifDate(null)).toBeNull(); expect(exifDate({ DateTimeOriginal: '2026:07:04 12:00:00' })).toBe('2026-07-04'); expect(exifDate({ DateTimeOriginal: '2026:99:99 12:00:00' })).toBeNull(); });
});

describe('retrieval', () => {
  const photos = [photo('beach'), photo('cafe', { analysis: analysis('A restaurant with green booths at night', 1) }), photo('receipt', { analysis: { ...analysis('A receipt', 2), visibleText: 'LEMON CAKE' } })];
  it('combines visual and literal text matches', () => { expect(retrieve(photos, query())[0]?.photo.id).toBe('beach'); expect(retrieve(photos, { ...query('LEMON CAKE'), embedding: analysis('', 2).embedding })[0]?.photo.id).toBe('receipt'); });
  it('excludes incomplete and removed photos', () => {
    expect(retrieve([photo('pending', { status: 'pending', analysis: null })], query())).toEqual([]);
    expect(retrieve(photos.filter(p => p.id !== 'beach'), query()).some(h => h.photo.id === 'beach')).toBe(false);
  });
  it('uses inclusive dates and excludes unknown dates only when filtering', () => {
    const items = [photo('known'), photo('unknown', { capturedAt: null })];
    expect(retrieve(items, query())).toHaveLength(2);
    expect(retrieve(items, { ...query(), dates: { from: '2026-07-04', to: '2026-07-04' } }).map(h => h.photo.id)).toEqual(['known']);
    expect(retrieve(items, { ...query(), dates: { from: '2027-01-01', to: null } })).toHaveLength(0);
  });
  it('does not turn similarity scores into a claim of exactness', () => { expect(cosine([0, 0], [1, 1])).toBe(0); expect(cosine([1], [1, 2])).toBe(0); });
  it('rejects injected/missing IDs in optional ranking', () => {
    const hits = retrieve(photos, query());
    expect(applyRanking(hits, { mode: 'jev', results: [{ id: 'invented', score: 1 }] })).toBe(hits);
    expect(applyRanking(hits, { mode: 'baseline', results: [] })).toBe(hits);
    expect(applyRanking(hits, { mode: 'jev', results: photos.map(p => ({ id: p.id, score: p.id === 'cafe' ? 1 : 0 })) })[0]?.photo.id).toBe('cafe');
  });
});

function memoryStore(items: Photo[]): IndexStore {
  return {
    list: async () => items,
    setStatus: async (id, status, error) => { const p = items.find(p => p.id === id)!; p.status = status; p.error = error ?? null; },
    complete: async (id, result) => { const p = items.find(p => p.id === id)!; p.analysis = result; p.status = 'ready'; },
  };
}
describe('index queue', () => {
  it('never calls analysis before consent', async () => {
    const analyze = vi.fn();
    await expect(indexCollection({ store: memoryStore([photo()]), analyze, consentVersion: null, shouldContinue: () => true })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('skips completed photos on restart and processes one at a time', async () => {
    const items = [photo('done'), photo('new', { status: 'pending', analysis: null })];
    const analyze = vi.fn(async () => analysis());
    const options = { store: memoryStore(items), analyze, consentVersion: CONSENT_VERSION, shouldContinue: () => true };
    expect((await indexCollection(options)).completed).toBe(1);
    expect((await indexCollection(options)).completed).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('saves progress and stops immediately at quota exhaustion', async () => {
    const items = ['a', 'b', 'c'].map(id => photo(id, { status: 'pending', analysis: null }));
    const analyze = vi.fn().mockResolvedValueOnce(analysis()).mockRejectedValueOnce(new ServiceError('QUOTA', 'Wait', 60));
    await expect(indexCollection({ store: memoryStore(items), analyze, consentVersion: CONSENT_VERSION, shouldContinue: () => true })).rejects.toMatchObject({ code: 'QUOTA' });
    expect(items.map(p => p.status)).toEqual(['ready', 'error', 'pending']); expect(analyze).toHaveBeenCalledTimes(2);
  });
  it('pauses between photos on backgrounding or manual pause', async () => {
    let active = true;
    const items = ['a', 'b'].map(id => photo(id, { status: 'pending', analysis: null }));
    const result = await indexCollection({ store: memoryStore(items), consentVersion: CONSENT_VERSION, shouldContinue: () => active, analyze: async () => { active = false; return analysis(); } });
    expect(result).toEqual({ completed: 1, paused: true }); expect(items[1]?.status).toBe('pending');
  });
});
