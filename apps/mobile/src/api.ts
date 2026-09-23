import { z } from 'zod';
import { AnalysisSchema, PreparedQuerySchema, RankResponseSchema, HealthSchema, ApiErrorSchema, ServiceError, CONSENT_VERSION, type QueryRequest, type RankRequest } from '@captured/core';
import { store } from './store';

export async function callApi<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const url = await store.setting('server-url');
  const token = await store.token();
  if (!url || token.length < 32) throw new ServiceError('SETUP_REQUIRED', 'Open Settings to connect your local server.');
  const isGemini = path === '/analyze' || path === '/query';
  if (isGemini) {
    const resumeAt = Number(await store.setting('gemini-resume-after') ?? 0);
    if (resumeAt > Date.now()) throw new ServiceError('QUOTA', 'Free requests are paused until the retry window ends. Saved searches still work.', Math.ceil((resumeAt - Date.now()) / 1000));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path === '/analyze' ? 100000 : 65000);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(data);
      if (parsed.success) {
        if (isGemini && parsed.data.code === 'QUOTA') await store.setSetting('gemini-resume-after', String(Date.now() + (parsed.data.retryAfterSeconds ?? 60) * 1000));
        throw new ServiceError(parsed.data.code, parsed.data.message, parsed.data.retryAfterSeconds);
      }
      throw new ServiceError('PROVIDER_UNAVAILABLE', 'The local server returned an unexpected response.');
    }
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('PROVIDER_UNAVAILABLE', 'Could not reach a usable response from your Mac. Check the server, Wi-Fi, and Settings. Work already completed is saved.');
  } finally { clearTimeout(timer); }
}

export const api = {
  health: () => callApi('/health', HealthSchema),
  analyze: (imageBase64: string) => callApi('/analyze', AnalysisSchema, { consentVersion: CONSENT_VERSION, imageBase64 }),
  query: (input: QueryRequest) => callApi('/query', PreparedQuerySchema, input),
  rank: (input: RankRequest) => callApi('/rank', RankResponseSchema, input),
};
