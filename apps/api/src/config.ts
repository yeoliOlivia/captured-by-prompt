export interface Config {
  token: string;
  host: string;
  port: number;
  geminiKey: string;
  geminiFreeConfirmed: boolean;
  jevKey: string;
  jevEnabled: boolean;
  jevPromoConfirmed: boolean;
  jevRefillDisabled: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.DEV_TOKEN ?? '';
  if (token.length < 32 || token.includes('replace-with')) throw new Error('Set DEV_TOKEN to a random token of at least 32 characters. Run npm run token.');
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  return {
    token, port, host: env.HOST ?? '127.0.0.1',
    geminiKey: env.GEMINI_API_KEY ?? '',
    geminiFreeConfirmed: env.GEMINI_BILLING_DISABLED_CONFIRMED === 'true',
    jevKey: env.TYPESAFE_API_KEY ?? '', jevEnabled: env.JEV_ENABLED === 'true',
    jevPromoConfirmed: env.JEV_PROMOTIONAL_ONLY_CONFIRMED === 'true',
    jevRefillDisabled: env.JEV_AUTO_REFILL_DISABLED_CONFIRMED === 'true',
  };
}

export function geminiReady(c: Config): boolean { return Boolean(c.geminiKey && c.geminiFreeConfirmed); }
export function jevReady(c: Config): boolean { return Boolean(c.jevEnabled && c.jevKey && c.jevPromoConfirmed && c.jevRefillDisabled); }
