import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION } from '@captured/core';
import { query } from '../../../packages/core/src/test-fixtures';

const settings = vi.hoisted(() => new Map<string, string>());
vi.mock('./store', () => ({ store: {
  setting: async (key: string) => settings.get(key) ?? null,
  setSetting: async (key: string, value: string) => { settings.set(key, value); },
  token: async () => 'a'.repeat(40),
} }));
const request = { consentVersion: CONSENT_VERSION, prompt: 'beach', history: [], today: '2026-09-22' };
beforeEach(() => { settings.clear(); settings.set('server-url', 'http://192.168.1.2:8787'); });
afterEach(() => vi.unstubAllGlobals());

describe('mobile network boundary', () => {
  it('persists quota cooldown and refuses another provider call before retry time', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'QUOTA', message: 'wait', retryAfterSeconds: 120 }), { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api');
    await expect(api.query(request)).rejects.toMatchObject({ code: 'QUOTA' });
    expect(Number(settings.get('gemini-resume-after'))).toBeGreaterThan(Date.now());
    await expect(api.query(request)).rejects.toMatchObject({ code: 'QUOTA' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not confuse a failed rank request with Gemini quota', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ mode: 'baseline', results: [], reason: 'Jev is off' })));
    vi.stubGlobal('fetch', fetch);
    const { api } = await import('./api');
    expect((await api.rank({ consentVersion: CONSENT_VERSION, query: 'beach', candidates: [] })).mode).toBe('baseline');
    expect(settings.has('gemini-resume-after')).toBe(false);
  });
  it('validates server output instead of substituting fake AI results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...query(), embedding: [] }))));
    const { api } = await import('./api');
    await expect(api.query(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
