import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { AnalysisSchema, PreparedQuerySchema, RankResponseSchema, assertCapacity, type Photo, type Analysis, type PreparedQuery, type RankResponse } from '@captured/core';

let opening: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  if (!opening) opening = (async () => {
    const database = await SQLite.openDatabaseAsync('captured.db');
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY, assetId TEXT, uri TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, capturedAt TEXT,
        status TEXT NOT NULL, analysis TEXT, error TEXT, addedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS searches (key TEXT PRIMARY KEY, query TEXT NOT NULL, ranking TEXT);
      UPDATE photos SET status = 'pending' WHERE status = 'indexing';
    `);
    return database;
  })();
  return opening;
}
type Row = Omit<Photo, 'analysis'> & { analysis: string | null };
function fromRow(row: Row): Photo {
  const result = row.analysis ? AnalysisSchema.safeParse(JSON.parse(row.analysis)) : null;
  return { ...row, analysis: result?.success ? result.data : null, status: row.status === 'ready' && !result?.success ? 'pending' : row.status };
}
export const store = {
  async list(): Promise<Photo[]> { return (await (await db()).getAllAsync<Row>('SELECT * FROM photos ORDER BY addedAt, id')).map(fromRow); },
  async get(id: string): Promise<Photo | null> {
    const row = await (await db()).getFirstAsync<Row>('SELECT * FROM photos WHERE id = ?', id);
    return row ? fromRow(row) : null;
  },
  async add(photos: Photo[]) {
    const database = await db();
    await database.withExclusiveTransactionAsync(async tx => {
      const count = await tx.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM photos');
      assertCapacity(count?.count ?? 0, photos.length);
      for (const p of photos) await tx.runAsync('INSERT INTO photos (id, assetId, uri, width, height, capturedAt, status, addedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', p.id, p.assetId, p.uri, p.width, p.height, p.capturedAt, p.status, p.addedAt);
      await tx.runAsync('DELETE FROM searches');
    });
  },
  async setStatus(id: string, status: Photo['status'], error?: string) { await (await db()).runAsync('UPDATE photos SET status = ?, error = ? WHERE id = ?', status, error ?? null, id); },
  async complete(id: string, analysis: Analysis) {
    const database = await db();
    await database.withExclusiveTransactionAsync(async tx => {
      await tx.runAsync("UPDATE photos SET status = 'ready', analysis = ?, error = NULL WHERE id = ?", JSON.stringify(analysis), id);
      await tx.runAsync('DELETE FROM searches');
    });
  },
  async remove(id: string) {
    const database = await db();
    await database.withExclusiveTransactionAsync(async tx => { await tx.runAsync('DELETE FROM photos WHERE id = ?', id); await tx.runAsync('DELETE FROM searches'); });
  },
  async clear() {
    const database = await db();
    await database.withExclusiveTransactionAsync(async tx => { await tx.runAsync('DELETE FROM photos'); await tx.runAsync('DELETE FROM searches'); });
  },
  async setting(key: string): Promise<string | null> { return (await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null; },
  async setSetting(key: string, value: string) { await (await db()).runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value); },
  async cached(key: string): Promise<{ query: PreparedQuery; ranking: RankResponse | null } | null> {
    const row = await (await db()).getFirstAsync<{ query: string; ranking: string | null }>('SELECT query, ranking FROM searches WHERE key = ?', key);
    if (!row) return null;
    try { return { query: PreparedQuerySchema.parse(JSON.parse(row.query)), ranking: row.ranking ? RankResponseSchema.parse(JSON.parse(row.ranking)) : null }; }
    catch { return null; }
  },
  async cache(key: string, query: PreparedQuery, ranking: RankResponse | null) { await (await db()).runAsync('INSERT OR REPLACE INTO searches (key, query, ranking) VALUES (?, ?, ?)', key, JSON.stringify(query), ranking ? JSON.stringify(ranking) : null); },
  async token(): Promise<string> { return await SecureStore.getItemAsync('dev-token') ?? ''; },
  async setToken(token: string) { await SecureStore.setItemAsync('dev-token', token); },
};
