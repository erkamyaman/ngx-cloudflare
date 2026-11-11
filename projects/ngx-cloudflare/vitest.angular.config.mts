import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^ngx-cloudflare\/server$/, replacement: source('./server/src/public-api.ts') },
      { find: /^ngx-cloudflare\/testing$/, replacement: source('./testing/src/public-api.ts') },
      { find: /^ngx-cloudflare$/, replacement: source('./src/public-api.ts') },
    ],
  },
  oxc: {
    decorator: { legacy: true },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [source('./vitest.angular.setup.ts')],
    include: [
      'projects/ngx-cloudflare/src/**/*.spec.ts',
      'projects/ngx-cloudflare/testing/**/*.spec.ts',
    ],
  },
});
