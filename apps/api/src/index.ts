import { buildApp } from './app';
import { readConfig } from './config';

try {
  const config = readConfig();
  const app = buildApp(config);
  await app.listen({ host: config.host, port: config.port });
  console.log(`Captured by Prompt API listening on ${config.host}:${config.port} (free-only; no paid fallback).`);
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not start the API.');
  process.exit(1);
}
