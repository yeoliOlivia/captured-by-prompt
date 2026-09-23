import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysis, photo, query } from '../../../packages/core/src/test-fixtures';

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const database = state.db!;
    const adapter = {
      execAsync: async (sql: string) => database.exec(sql),
      runAsync: async (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).run(...params),
      getFirstAsync: async (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).get(...params) ?? null,
      getAllAsync: async (sql: string, ...params: (string | number | null)[]) => database.prepare(sql).all(...params),
      withExclusiveTransactionAsync: async (fn: (tx: unknown) => Promise<void>) => {
        database.exec('BEGIN');
        try { await fn(adapter); database.exec('COMMIT'); }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      },
    };
    return adapter;
  },
}));
beforeEach(() => { vi.resetModules(); state.db = new DatabaseSync(':memory:'); });
afterEach(() => state.db?.close());

describe('persistent index SQL (real SQLite, Expo bridge substituted)', () => {
  it('rejects a 31st photo atomically', async () => {
    const { store } = await import('./store');
    await store.add(Array.from({ length: 30 }, (_, i) => photo(String(i), { status: 'pending', analysis: null })));
    await expect(store.add([photo('31')])).rejects.toThrow('30');
    expect(await store.list()).toHaveLength(30);
  });
  it('retains completed analysis across reloads and recovers an interrupted photo', async () => {
    const { store } = await import('./store');
    await store.add([photo('done'), photo('interrupted', { status: 'indexing', analysis: null })]);
    await store.complete('done', analysis());
    vi.resetModules();
    const restarted = (await import('./store')).store;
    expect(await restarted.get('done')).toMatchObject({ status: 'ready', analysis: analysis() });
    expect(await restarted.get('interrupted')).toMatchObject({ status: 'pending', analysis: null });
  });
  it('invalidates cached rankings when a photo is removed or added', async () => {
    const { store } = await import('./store');
    await store.add([photo('a'), photo('b')]);
    await store.cache('search', query(), { mode: 'jev', results: [{ id: 'a', score: 1 }, { id: 'b', score: 0 }] });
    expect((await store.cached('search'))?.ranking?.mode).toBe('jev');
    await store.remove('a');
    expect(await store.get('a')).toBeNull(); expect(await store.cached('search')).toBeNull();
    await store.cache('search', query(), null);
    await store.add([photo('c')]); expect(await store.cached('search')).toBeNull();
  });
  it('clears photos and derived data without deleting connection settings', async () => {
    const { store } = await import('./store');
    await store.setSetting('server-url', 'http://192.168.1.10:8787');
    await store.add([photo()]); await store.cache('search', query(), null);
    await store.clear();
    expect(await store.list()).toEqual([]); expect(await store.cached('search')).toBeNull();
    expect(await store.setting('server-url')).toBe('http://192.168.1.10:8787');
  });
});
