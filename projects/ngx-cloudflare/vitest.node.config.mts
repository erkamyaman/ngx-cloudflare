import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'projects/ngx-cloudflare/server/src/**/*.spec.ts',
      'projects/ngx-cloudflare/schematics/**/*.spec.ts',
    ],
    testTimeout: 60_000,
  },
});
