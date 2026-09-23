import { ServiceError } from '@captured/core';

export function providerError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  const e = error as { status?: number; statusCode?: number; message?: string; retryAfterMs?: number };
  const status = e?.status ?? e?.statusCode;
  // Inspect provider details for retry timing, but never send the raw error to the phone/logs.
  if (status === 429 || status === 402) {
    let retry = e?.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : undefined;
    try {
      const body = JSON.parse(e?.message ?? '{}');
      const details = body.error?.details ?? body.details ?? [];
      for (const detail of details) {
        if (typeof detail.retryDelay === 'string') retry = Math.max(retry ?? 0, Math.ceil(parseFloat(detail.retryDelay)));
      }
      if (/per.?day|daily/i.test(JSON.stringify(details))) retry = Math.max(retry ?? 0, 86400);
    } catch { /* SDK may not expose structured retry details. */ }
    return new ServiceError('QUOTA', 'Free allowance or rate limit reached. Work is saved. Wait for the allowance to reset, then resume; paid access will not be enabled.', retry && Number.isFinite(retry) ? retry : 60);
  }
  if (status === 401 || status === 403 || status === 404) return new ServiceError('SETUP_REQUIRED', 'The configured free account cannot access this model. Check its key and model eligibility. Do not enable billing.');
  return new ServiceError('PROVIDER_UNAVAILABLE', 'The AI service did not return a usable response. Your completed work is saved. Try again later.');
}
