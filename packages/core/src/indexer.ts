import { CONSENT_VERSION, ServiceError, type Analysis, type Photo } from './contracts';

export interface IndexStore {
  list(): Promise<Photo[]>;
  setStatus(id: string, status: Photo['status'], error?: string): Promise<void>;
  complete(id: string, analysis: Analysis): Promise<void>;
}

export async function indexCollection(options: {
  store: IndexStore;
  consentVersion: string | null;
  analyze: (photo: Photo) => Promise<Analysis>;
  shouldContinue: () => boolean;
  onProgress?: () => Promise<void>;
}): Promise<{ completed: number; paused: boolean }> {
  if (options.consentVersion !== CONSENT_VERSION) throw new ServiceError('CONSENT_REQUIRED', 'Accept the cloud-analysis disclosure first.');
  let completed = 0;
  for (const photo of await options.store.list()) {
    if (!options.shouldContinue()) return { completed, paused: true };
    if (photo.status === 'ready' && photo.analysis) continue;
    await options.store.setStatus(photo.id, 'indexing');
    await options.onProgress?.();
    try {
      const analysis = await options.analyze(photo);
      await options.store.complete(photo.id, analysis);
      completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not analyze this photo.';
      await options.store.setStatus(photo.id, 'error', message);
      await options.onProgress?.();
      // Quota/setup/network failures pause the whole queue. Never switch to a paid model.
      throw error;
    }
    await options.onProgress?.();
  }
  return { completed, paused: false };
}
