import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getPlatformProxy = vi.fn();
vi.mock('wrangler', () => ({ getPlatformProxy }));

const { createCloudflareRequestHandler } = await import('./cloudflare-request-handler');

afterEach(() => {
  delete (globalThis as { __ngxCloudflarePlatformProxy?: unknown }).__ngxCloudflarePlatformProxy;
  getPlatformProxy.mockReset();
});

describe('createCloudflareRequestHandler under ng serve', () => {
  it('starts the platform proxy again after a failed start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getPlatformProxy
      .mockRejectedValueOnce(new Error('bad wrangler.jsonc'))
      .mockResolvedValueOnce({ env: { GREETING: 'hi' }, ctx: {}, cf: {} });
    const handler = createCloudflareRequestHandler<{ GREETING?: string }>({
      api: (_request, env) => Response.json({ greeting: env?.GREETING ?? null }),
    });

    const first = await handler(new Request('http://localhost/api/greeting'));
    const second = await handler(new Request('http://localhost/api/greeting'));

    expect(await first.json()).toEqual({ greeting: null });
    expect(await second.json()).toEqual({ greeting: 'hi' });
    expect(getPlatformProxy).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('starts the proxy once and reuses it', async () => {
    getPlatformProxy.mockResolvedValue({ env: {}, ctx: {}, cf: {} });
    const handler = createCloudflareRequestHandler({ api: () => new Response('ok') });
    await handler(new Request('http://localhost/api/a'));
    await handler(new Request('http://localhost/api/b'));
    expect(getPlatformProxy).toHaveBeenCalledTimes(1);
  });
});
