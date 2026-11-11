import { describe, expect, it, vi } from 'vitest';
import {
  createCloudflareFetch,
  hostsFromEnv,
  isCloudflareContext,
  isHostAllowed,
  isInProcessRequest,
  resolveAllowedHosts,
  stripProxyHeaders,
  type CloudflareContext,
  type RenderFunction,
} from './cloudflare-fetch';

const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };

function capture(): {
  render: RenderFunction;
  calls: { request: Request; context: CloudflareContext<any, any> | undefined }[];
} {
  const calls: { request: Request; context: CloudflareContext<any, any> | undefined }[] = [];
  return {
    calls,
    render: async (request, context) => {
      calls.push({ request, context });
      return new Response('page');
    },
  };
}

describe('resolveAllowedHosts', () => {
  it('starts from the defaults and dedupes', () => {
    expect(resolveAllowedHosts(['Example.com', 'localhost', ' '])).toEqual([
      'localhost',
      '127.0.0.1',
      '*.workers.dev',
      'example.com',
    ]);
  });
});

describe('hostsFromEnv', () => {
  it('splits ALLOWED_HOSTS on commas and whitespace', () => {
    expect(hostsFromEnv({ ALLOWED_HOSTS: ' a.com,b.com  c.com ' })).toEqual([
      'a.com',
      'b.com',
      'c.com',
    ]);
  });

  it('ignores a missing or non-string var', () => {
    expect(hostsFromEnv(undefined)).toEqual([]);
    expect(hostsFromEnv({ ALLOWED_HOSTS: 1 })).toEqual([]);
  });
});

describe('isHostAllowed', () => {
  const hosts = resolveAllowedHosts(['example.com']);

  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['demo.someone.workers.dev', true],
    ['DEMO.someone.workers.dev', true],
    ['example.com', true],
    ['example.com.', true],
    ['workers.dev', false],
    ['www.example.com', false],
    ['evil-workers.dev', false],
    ['app.example.org', false],
  ])('%s -> %s', (host, allowed) => {
    expect(isHostAllowed(host, hosts)).toBe(allowed);
  });

  it('allows everything only with an explicit *', () => {
    expect(isHostAllowed('anything.test', ['*'])).toBe(true);
  });
});

describe('stripProxyHeaders', () => {
  it('removes forwarded and x-forwarded-* and keeps the rest', () => {
    const request = new Request('https://a.workers.dev/', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
        'X-Forwarded-Proto': 'https',
        forwarded: 'for=1',
        accept: 'text/html',
        'cf-connecting-ip': '1.2.3.4',
      },
    });
    const stripped = stripProxyHeaders(request);
    expect([...stripped.headers.keys()].sort()).toEqual(['accept', 'cf-connecting-ip']);
  });

  it('returns the same request when there is nothing to strip', () => {
    const request = new Request('https://a.workers.dev/');
    expect(stripProxyHeaders(request)).toBe(request);
  });
});

describe('createCloudflareFetch', () => {
  it('passes env, ctx and cf from the Workers runtime to the renderer', async () => {
    const { render, calls } = capture();
    const handler = createCloudflareFetch(render);
    const request = Object.assign(new Request('https://demo.x.workers.dev/'), {
      cf: { country: 'TR' },
    });
    const env = { GREETING: 'hi' };

    const response = await handler(request, env as never, ctx);

    expect(await response.text()).toBe('page');
    const context = calls[0].context!;
    expect(isCloudflareContext(context)).toBe(true);
    expect(context.env).toBe(env);
    expect(context.ctx).toBe(ctx);
    expect(context.cf).toEqual({ country: 'TR' });
    expect(context.source).toBe('workers');
  });

  it('uses the dev platform when the runtime gives no env', async () => {
    const { render, calls } = capture();
    const env = { FROM: 'proxy' };
    const handler = createCloudflareFetch(render, {}, async () => ({ env, ctx, cf: undefined }));

    await handler(new Request('http://localhost:4200/'));

    expect(calls[0].context?.env).toBe(env);
    expect(calls[0].context?.source).toBe('platform-proxy');
  });

  it('renders without a context when no platform is available', async () => {
    const { render, calls } = capture();
    await createCloudflareFetch(render)(new Request('http://localhost/'));
    expect(calls[0].context).toBeUndefined();
  });

  it('refuses unknown hosts with a clear 400 before rendering', async () => {
    const { render, calls } = capture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createCloudflareFetch(render);

    const response = await handler(new Request('https://app.example.com/'), {} as never, ctx);
    await handler(new Request('https://app.example.com/other'), {} as never, ctx);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('allowedHosts');
    expect(calls).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('keeps the refused-host log bounded and logs a host again once it was forgotten', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createCloudflareFetch(async () => new Response('page'));
    for (let i = 0; i < 150; i++) {
      await handler(new Request(`https://h${i}.example.com/`), {} as never, ctx);
    }
    await handler(new Request('https://h149.example.com/'), {} as never, ctx);
    expect(error).toHaveBeenCalledTimes(150);
    await handler(new Request('https://h0.example.com/'), {} as never, ctx);
    expect(error).toHaveBeenCalledTimes(151);
    error.mockRestore();
  });

  it('accepts hosts listed in the ALLOWED_HOSTS var', async () => {
    const { render } = capture();
    const handler = createCloudflareFetch(render);
    const env = { ALLOWED_HOSTS: 'shop.example.com, *.preview.example.com' };
    expect(
      (await handler(new Request('https://shop.example.com/'), env as never, ctx)).status,
    ).toBe(200);
    expect(
      (await handler(new Request('https://a.preview.example.com/'), env as never, ctx)).status,
    ).toBe(200);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      (await handler(new Request('https://other.example.com/'), env as never, ctx)).status,
    ).toBe(400);
    error.mockRestore();
  });

  it('accepts hosts added through options', async () => {
    const { render } = capture();
    const handler = createCloudflareFetch(render, { allowedHosts: ['app.example.com'] });
    expect((await handler(new Request('https://app.example.com/'), {} as never, ctx)).status).toBe(
      200,
    );
  });

  it('strips proxy headers before rendering, unless turned off', async () => {
    const { render, calls } = capture();
    const init = { headers: { 'x-forwarded-for': '1.2.3.4' } };
    await createCloudflareFetch(render)(new Request('http://localhost/', init));
    await createCloudflareFetch(render, { stripProxyHeaders: false })(
      new Request('http://localhost/', init),
    );
    expect(calls[0].request.headers.has('x-forwarded-for')).toBe(false);
    expect(calls[1].request.headers.has('x-forwarded-for')).toBe(true);
  });

  it('returns 404 when the renderer has no page', async () => {
    const response = await createCloudflareFetch(async () => null)(
      new Request('http://localhost/missing'),
    );
    expect(response.status).toBe(404);
  });

  describe('api', () => {
    it('sends /api/ requests to a plain function with env and ctx', async () => {
      const { render, calls } = capture();
      const api = vi.fn((_request: Request, env: { N: number }) => Response.json({ n: env.N }));
      const handler = createCloudflareFetch<{ N: number }>(render, { api });

      const response = await handler(new Request('https://d.workers.dev/api/n'), { N: 7 }, ctx);

      expect(await response.json()).toEqual({ n: 7 });
      expect(api.mock.calls[0][2]).toBe(ctx);
      expect(calls).toHaveLength(0);
    });

    it('falls through to Angular when the function returns nothing', async () => {
      const { render, calls } = capture();
      const handler = createCloudflareFetch(render, { api: () => undefined });
      await handler(new Request('http://localhost/api/unknown'));
      expect(calls).toHaveLength(1);
    });

    it('leaves non-api paths to Angular', async () => {
      const { render, calls } = capture();
      const api = vi.fn(() => new Response('api'));
      const handler = createCloudflareFetch(render, { api });
      await handler(new Request('http://localhost/apiary'));
      await handler(new Request('http://localhost/'));
      expect(api).not.toHaveBeenCalled();
      expect(calls).toHaveLength(2);
    });

    it('accepts an object with fetch, such as a Hono app, and a custom prefix', async () => {
      const app = { fetch: (request: Request) => new Response(new URL(request.url).pathname) };
      const handler = createCloudflareFetch(async () => null, { api: app, apiPrefix: '/rpc' });
      expect(await (await handler(new Request('http://localhost/rpc'))).text()).toBe('/rpc');
      expect(await (await handler(new Request('http://localhost/rpc/x'))).text()).toBe('/rpc/x');
      expect((await handler(new Request('http://localhost/api/x'))).status).toBe(404);
    });

    it('tries every path when apiPrefix is false', async () => {
      const handler = createCloudflareFetch(async () => null, {
        api: () => new Response('api'),
        apiPrefix: false,
      });
      expect(await (await handler(new Request('http://localhost/anything'))).text()).toBe('api');
    });

    it('still checks the host first', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const api = vi.fn(() => new Response('api'));
      const response = await createCloudflareFetch(async () => null, { api })(
        new Request('https://evil.test/api/x'),
        {} as never,
        ctx,
      );
      expect(response.status).toBe(400);
      expect(api).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });

  describe('dispatch', () => {
    it('answers own api calls in-process with the same bindings', async () => {
      const { render, calls } = capture();
      const handler = createCloudflareFetch<{ N: number }>(render, {
        api: (_request, env) => Response.json({ n: env.N }),
      });
      await handler(new Request('https://d.workers.dev/'), { N: 3 }, ctx);

      const response = await calls[0].context!.dispatch(new Request('https://d.workers.dev/api/n'));
      expect(await response!.json()).toEqual({ n: 3 });
    });

    it('serves static assets through the ASSETS binding and skips misses', async () => {
      const { render, calls } = capture();
      const ASSETS = {
        fetch: vi.fn(async (request: Request) =>
          new URL(request.url).pathname === '/data.json'
            ? Response.json({ ok: true })
            : new Response('nope', { status: 404 }),
        ),
      };
      await createCloudflareFetch(render)(
        new Request('https://d.workers.dev/'),
        { ASSETS } as never,
        ctx,
      );
      const { dispatch } = calls[0].context!;

      expect(
        await (await dispatch(new Request('https://d.workers.dev/data.json')))!.json(),
      ).toEqual({ ok: true });
      expect(await dispatch(new Request('https://d.workers.dev/missing'))).toBeNull();
      expect(
        await dispatch(
          new Request('https://d.workers.dev/data.json', { method: 'POST', body: '{}' }),
        ),
      ).toBeNull();
    });

    it('marks dispatched requests so handlers can tell them from network calls', async () => {
      const { render, calls } = capture();
      const seen: boolean[] = [];
      const handler = createCloudflareFetch(render, {
        api: (request) => {
          seen.push(isInProcessRequest(request));
          return Response.json({});
        },
      });
      await handler(new Request('https://d.workers.dev/api/x'), {} as never, ctx);
      await handler(new Request('https://d.workers.dev/'), {} as never, ctx);
      await calls[0].context!.dispatch(new Request('https://d.workers.dev/api/x'));
      expect(seen).toEqual([false, true]);
    });

    it('returns null when nothing handles the request', async () => {
      const { render, calls } = capture();
      await createCloudflareFetch(render)(new Request('https://d.workers.dev/'), {} as never, ctx);
      expect(
        await calls[0].context!.dispatch(new Request('https://d.workers.dev/api/x')),
      ).toBeNull();
    });
  });
});
