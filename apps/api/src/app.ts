import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import {
  AnalysisRequestSchema, QueryRequestSchema, RankRequestSchema, ServiceError, CONSENT_VERSION,
  AnalysisSchema, PreparedQuerySchema, RankResponseSchema, type Health,
} from '@captured/core';
import { geminiReady, jevReady, type Config } from './config';
import { createProviders, type Providers } from './providers';
import { providerError } from './errors';

export function buildApp(config: Config, suppliedProviders?: Providers) {
  const app = Fastify({ logger: false, bodyLimit: 8_100_000 });
  const usage = { inputTokens: 0, outputTokens: 0 };
  const providers = suppliedProviders ?? createProviders(config, u => { usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; });
  let lastProviderError: Health['lastProviderError'] = null;
  let geminiBlockedUntil = 0;
  let jevBlockedUntil = 0;
  let analysisBusy = false;
  const remember = (error: unknown, provider: 'gemini' | 'jev') => {
    const safe = providerError(error);
    lastProviderError = { code: safe.code, message: safe.message, ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) };
    if (safe.code === 'QUOTA') {
      if (provider === 'gemini') geminiBlockedUntil = Date.now() + (safe.retryAfterSeconds ?? 60) * 1000;
      else jevBlockedUntil = Date.now() + (safe.retryAfterSeconds ?? 60) * 1000;
    }
    return safe;
  };
  const requireGemini = () => {
    if (!geminiReady(config)) throw new ServiceError('SETUP_REQUIRED', 'Configure a free Gemini key and confirm billing is disabled in the backend .env.');
    if (Date.now() < geminiBlockedUntil) throw new ServiceError('QUOTA', 'Free quota is paused. Wait before resuming.', Math.ceil((geminiBlockedUntil - Date.now()) / 1000));
  };

  app.addHook('onRequest', async (request, reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Check the development token in Settings.' });
  });
  app.setErrorHandler((error, _request, reply) => {
    const safe = error instanceof ServiceError ? error : new ServiceError('INVALID_REQUEST', 'The request could not be processed. Check the selected photo and try again.');
    const status = safe.code === 'QUOTA' ? 429 : safe.code === 'SETUP_REQUIRED' ? 503 : safe.code === 'PROVIDER_UNAVAILABLE' ? 502 : 400;
    if (safe.retryAfterSeconds) reply.header('Retry-After', safe.retryAfterSeconds);
    return reply.code(status).send({ code: safe.code, message: safe.message, retryAfterSeconds: safe.retryAfterSeconds });
  });
  app.get('/health', async (): Promise<Health> => ({
    mode: 'free-only', geminiReady: geminiReady(config), jevReady: jevReady(config), lastProviderError, usage,
    issues: [
      ...(!geminiReady(config) ? ['Gemini needs a key from an unbilled project and explicit free-tier confirmation.'] : []),
      ...(!jevReady(config) ? ['Jev is off. Real embedding search remains available.'] : []),
    ],
  }));
  app.post('/analyze', async request => {
    if ((request.body as { consentVersion?: string })?.consentVersion !== CONSENT_VERSION) throw new ServiceError('CONSENT_REQUIRED', 'Accept the cloud-analysis disclosure first.');
    const input = AnalysisRequestSchema.parse(request.body);
    requireGemini();
    if (analysisBusy) throw new ServiceError('QUOTA', 'Another photo is being processed. Resume shortly.', 2);
    analysisBusy = true;
    try {
      let image: Buffer;
      try {
        // Decode/re-encode even client JPEGs: apply EXIF orientation, strip metadata and bound dimensions.
        image = await sharp(Buffer.from(input.imageBase64, 'base64'), { limitInputPixels: 40_000_000 })
          .rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      } catch { throw new ServiceError('INVALID_REQUEST', 'This image could not be decoded. Remove it and select it again.'); }
      try { return AnalysisSchema.parse(await providers.analyze(image)); }
      catch (error) { throw remember(error, 'gemini'); }
    } finally { analysisBusy = false; }
  });
  app.post('/query', async request => {
    if ((request.body as { consentVersion?: string })?.consentVersion !== CONSENT_VERSION) throw new ServiceError('CONSENT_REQUIRED', 'Accept the cloud-analysis disclosure first.');
    const input = QueryRequestSchema.parse(request.body);
    requireGemini();
    try { return PreparedQuerySchema.parse(await providers.prepare(input)); }
    catch (error) { throw remember(error, 'gemini'); }
  });
  app.post('/rank', async request => {
    const input = RankRequestSchema.parse(request.body);
    if (!jevReady(config) || Date.now() < jevBlockedUntil) return { mode: 'baseline', results: [], reason: 'Jev is unavailable. Showing embedding and text matches.' };
    try {
      const result = RankResponseSchema.parse(await providers.rank(input));
      const ids = new Set(result.results.map(r => r.id));
      if (ids.size !== input.candidates.length || input.candidates.some(c => !ids.has(c.id))) throw new Error('Invalid ranking');
      return result;
    } catch (error) {
      remember(error, 'jev');
      return { mode: 'baseline', results: [], reason: 'Jev could not rank this search. Showing embedding and text matches.' };
    }
  });
  return app;
}
