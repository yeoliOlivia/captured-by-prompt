import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['playground/**/*.test.ts', 'packages/**/*.test.ts', 'apps/api/**/*.test.ts', 'apps/mobile/src/**/*.test.ts'], testTimeout: 10000 },
});
