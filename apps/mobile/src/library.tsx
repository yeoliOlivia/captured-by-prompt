import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  CONSENT_VERSION, ServiceError, indexCollection, retrieve, applyRanking, queryCacheKey,
  type Photo, type SearchHit, type PreparedQuery, type RankResponse,
} from '@captured/core';
import { store } from './store';
import { api } from './api';
import { selectPhotos, previewBase64, deleteLocalPhoto, deleteAllLocalPhotos } from './photos';

type Activity = 'selecting' | 'indexing' | 'searching' | 'deleting' | null;
interface Library {
  photos: Photo[]; ready: boolean; activity: Activity; consent: boolean; notice: string;
  hits: SearchHit[] | null; history: string[]; resolved: PreparedQuery | null;
  searchSource: string; rankingMode: 'jev' | 'baseline';
  acceptConsent(): Promise<void>; revokeConsent(): Promise<void>;
  add(): Promise<void>; index(): Promise<void>; pause(): void;
  search(prompt: string): Promise<void>; newSearch(): void;
  remove(id: string): Promise<void>; clear(): Promise<void>; setNotice(text: string): void;
}
const Context = createContext<Library | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false);
  const [activity, setActivity] = useState<Activity>(null);
  const [notice, setNotice] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [resolved, setResolved] = useState<PreparedQuery | null>(null);
  const [rankingMode, setRankingMode] = useState<'jev' | 'baseline'>('baseline');
  const [searchSource, setSearchSource] = useState('');
  const busy = useRef(false);
  const keepIndexing = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  const refresh = async () => setPhotos(await store.list());

  useEffect(() => {
    Promise.all([refresh(), store.setting('consent')]).then(([, value]) => setConsent(value === CONSENT_VERSION))
      .catch(() => setNotice('Could not open the local index. Close and reopen the app.'))
      .finally(() => setReady(true));
    const subscription = AppState.addEventListener('change', state => {
      appActive.current = state === 'active';
      if (state !== 'active') keepIndexing.current = false;
    });
    return () => subscription.remove();
  }, []);

  function resetSearch() { setHits(null); setHistory([]); setResolved(null); setSearchSource(''); setRankingMode('baseline'); }
  async function perform(kind: Activity, action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true; setActivity(kind); setNotice('');
    try { await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
      setNotice(message + (error instanceof ServiceError && error.retryAfterSeconds ? ` Try again after ${new Date(Date.now() + error.retryAfterSeconds * 1000).toLocaleTimeString()}.` : ''));
    } finally { busy.current = false; setActivity(null); }
  }
  const value: Library = {
    photos, ready, activity, consent, notice, hits, history, resolved, searchSource, rankingMode, setNotice,
    async acceptConsent() { await store.setSetting('consent', CONSENT_VERSION); setConsent(true); },
    async revokeConsent() { if (busy.current) return; await store.setSetting('consent', ''); setConsent(false); setNotice('Cloud analysis is off. Your local collection remains on this phone.'); },
    async add() { await perform('selecting', async () => {
      const count = await selectPhotos(); await refresh();
      if (count) { resetSearch(); setNotice(`${count} photo${count === 1 ? '' : 's'} added. Start indexing when you’re ready.`); }
    }); },
    async index() { await perform('indexing', async () => {
      keepIndexing.current = true;
      const result = await indexCollection({
        store, consentVersion: consent ? CONSENT_VERSION : null,
        shouldContinue: () => keepIndexing.current && appActive.current,
        analyze: async photo => api.analyze(await previewBase64(photo)),
        onProgress: refresh,
      });
      setNotice(result.paused ? 'Indexing paused. Completed photos are saved; tap Resume indexing to continue.' : 'Your selected photos are searchable. Describe the one you remember.');
    }); },
    pause() { keepIndexing.current = false; setNotice('Pausing after the current photo finishes.'); },
    async search(prompt) { await perform('searching', async () => {
      if (!consent) throw new ServiceError('CONSENT_REQUIRED', 'Accept the cloud-analysis disclosure before searching.');
      if (!prompt.trim()) return;
      if (history.length >= 8) throw new Error('Start a new search after eight prompts to keep requests small.');
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const request = { consentVersion: CONSENT_VERSION as typeof CONSENT_VERSION, prompt: prompt.trim(), history, today };
      const key = queryCacheKey(request);
      const cached = await store.cached(key);
      const query = cached?.query ?? await api.query(request);
      const currentPhotos = await store.list();
      const baseline = retrieve(currentPhotos, query);
      let ranking: RankResponse = cached?.ranking ?? { mode: 'baseline', results: [] };
      if (!cached) {
        await store.cache(key, query, null);
        if (baseline.length) {
          try {
            ranking = await api.rank({ consentVersion: CONSENT_VERSION, query: query.text, candidates: baseline.map(({ photo }) => ({ id: photo.id, description: photo.analysis!.description, visibleText: photo.analysis!.visibleText, capturedAt: photo.capturedAt })) });
          } catch { ranking = { mode: 'baseline', results: [], reason: 'Jev is unavailable. Showing embedding and text matches.' }; }
        }
        await store.cache(key, query, ranking);
      }
      setHits(applyRanking(baseline, ranking)); setResolved(query); setHistory([...history, prompt.trim()]);
      setSearchSource(cached ? 'Saved search · no model calls' : 'Search complete'); setRankingMode(ranking.mode);
      if (!baseline.length) setNotice('No indexed photos fit these date constraints. Start a new search or add different photos.');
      else if (ranking.reason) setNotice(ranking.reason);
    }); },
    newSearch() { if (!busy.current) { resetSearch(); setNotice(''); } },
    async remove(id) { await perform('deleting', async () => {
      const photo = await store.get(id);
      if (photo) { deleteLocalPhoto(photo); await store.remove(id); }
      resetSearch(); await refresh(); setNotice('Removed from this app. Your camera-roll original is unchanged.');
    }); },
    async clear() { await perform('deleting', async () => {
      deleteAllLocalPhotos(); await store.clear(); resetSearch(); await refresh();
      setNotice('Local photos, descriptions, embeddings, and cached searches have been deleted.');
    }); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLibrary() {
  const library = useContext(Context);
  if (!library) throw new Error('LibraryProvider is missing.');
  return library;
}
