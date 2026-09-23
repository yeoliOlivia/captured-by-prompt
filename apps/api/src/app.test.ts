import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { CONSENT_VERSION, ServiceError } from '@captured/core';
import { analysis, query } from '../../../packages/core/src/test-fixtures';
import { buildApp } from './app';
import { readConfig, type Config } from './config';
import { providerError } from './errors';
import type { Providers } from './providers';

const config: Config = { token: 'a'.repeat(40), host: '127.0.0.1', port: 8787, geminiKey: 'test-key', geminiFreeConfirmed: true, jevKey: '', jevEnabled: false, jevPromoConfirmed: false, jevRefillDisabled: false };
const headers = { authorization: `Bearer ${config.token}` };
const apps: ReturnType<typeof buildApp>[] = [];
const setup = (overrides: Partial<Config> = {}) => {
  const providers: Providers = { analyze: vi.fn(async () => analysis()), prepare: vi.fn(async () => query()), rank: vi.fn(async () => ({ mode: 'jev' as const, results: [{ id: 'one', score: 0.9 }] })) };
  const app = buildApp({ ...config, ...overrides }, providers); apps.push(app); return { app, providers };
};
const jpeg = async () => (await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#448866' } }).jpeg().toBuffer()).toString('base64');
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

describe('free-only API', () => {
  it('requires authentication even for health, without exposing provider keys', async () => {
    const { app } = setup();
    expect((await app.inject('/health')).statusCode).toBe(401);
    const res = await app.inject({ url: '/health', headers });
    expect(res.json()).toMatchObject({ mode: 'free-only', geminiReady: true, jevReady: false });
    expect(res.body).not.toContain('test-key');
  });
  it('blocks analysis without consent and without confirmed unbilled setup', async () => {
    const { app, providers } = setup({ geminiFreeConfirmed: false });
    const payload = { imageBase64: await jpeg() };
    expect((await app.inject({ method: 'POST', url: '/analyze', headers, payload })).json().code).toBe('CONSENT_REQUIRED');
    expect((await app.inject({ method: 'POST', url: '/analyze', headers, payload: { ...payload, consentVersion: CONSENT_VERSION } })).json().code).toBe('SETUP_REQUIRED');
    expect(providers.analyze).not.toHaveBeenCalled();
  });
  it('re-encodes images before inference and bounds the longest edge', async () => {
    const { app, providers } = setup();
    const result = await app.inject({ method: 'POST', url: '/analyze', headers, payload: { consentVersion: CONSENT_VERSION, imageBase64: await jpeg() } });
    expect(result.statusCode).toBe(200);
    const image = vi.mocked(providers.analyze).mock.calls[0]![0];
    expect(await sharp(image).metadata()).toMatchObject({ width: 1024, height: 512, format: 'jpeg' });
    expect((await sharp(image).metadata()).exif).toBeUndefined();
  });
  it('rejects malformed images without calling AI', async () => {
    const { app, providers } = setup();
    const result = await app.inject({ method: 'POST', url: '/analyze', headers, payload: { consentVersion: CONSENT_VERSION, imageBase64: 'a'.repeat(24) } });
    expect(result.statusCode).toBe(400); expect(providers.analyze).not.toHaveBeenCalled();
  });
  it('passes refinement context and explicit date to the query provider', async () => {
    const { app, providers } = setup();
    const payload = { consentVersion: CONSENT_VERSION, prompt: 'only at night', history: ['green restaurant booths'], today: '2026-09-22' };
    expect((await app.inject({ method: 'POST', url: '/query', headers, payload })).statusCode).toBe(200);
    expect(providers.prepare).toHaveBeenCalledWith(payload);
  });
  it('pauses all Gemini requests on 429 without a fallback call', async () => {
    const { app, providers } = setup();
    vi.mocked(providers.prepare).mockRejectedValueOnce({ status: 429, message: '{"error":{"details":[{"retryDelay":"120s"}]}}' });
    const payload = { consentVersion: CONSENT_VERSION, prompt: 'beach', history: [], today: '2026-09-22' };
    const result = await app.inject({ method: 'POST', url: '/query', headers, payload });
    expect(result.statusCode).toBe(429); expect(result.headers['retry-after']).toBe('120');
    await app.inject({ method: 'POST', url: '/query', headers, payload });
    expect(providers.prepare).toHaveBeenCalledTimes(1); expect(providers.rank).not.toHaveBeenCalled();
  });
  it('requires every Jev promotional-access gate', async () => {
    const { app, providers } = setup({ jevKey: 'test', jevEnabled: true, jevPromoConfirmed: true });
    const payload = { consentVersion: CONSENT_VERSION, query: 'beach', candidates: [{ id: 'one', description: 'beach', visibleText: '', capturedAt: null }] };
    const res = await app.inject({ method: 'POST', url: '/rank', headers, payload });
    expect(res.json().mode).toBe('baseline'); expect(providers.rank).not.toHaveBeenCalled();
  });
  it('falls back when Jev fails or invents a candidate', async () => {
    const { app, providers } = setup({ jevKey: 'test', jevEnabled: true, jevPromoConfirmed: true, jevRefillDisabled: true });
    const payload = { consentVersion: CONSENT_VERSION, query: 'beach', candidates: [{ id: 'one', description: 'beach', visibleText: '', capturedAt: null }] };
    vi.mocked(providers.rank).mockResolvedValueOnce({ mode: 'jev', results: [{ id: 'invented', score: 1 }] }).mockRejectedValueOnce(new ServiceError('QUOTA', 'No free credit', 60));
    expect((await app.inject({ method: 'POST', url: '/rank', headers, payload })).json().mode).toBe('baseline');
    expect((await app.inject({ method: 'POST', url: '/rank', headers, payload })).json().mode).toBe('baseline');
  });
  it('sanitizes provider errors and disables configuration by default', () => {
    expect(providerError(new Error('secret-key private description')).message).not.toContain('secret-key');
    expect(providerError({ status: 429, message: '{"details":[{"quotaId":"perDay"}]}' }).retryAfterSeconds).toBe(86400);
    expect(readConfig({ DEV_TOKEN: 'z'.repeat(40) }).geminiFreeConfirmed).toBe(false);
    expect(() => readConfig({ DEV_TOKEN: 'short' })).toThrow();
  });
});
