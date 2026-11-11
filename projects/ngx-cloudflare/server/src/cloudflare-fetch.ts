declare global {
  namespace Cloudflare {
    interface Env {}
  }
}

export const CLOUDFLARE_CONTEXT_MARKER: unique symbol = Symbol.for(
  'ngx-cloudflare.context',
) as never;

export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '*.workers.dev'];

export const DEFAULT_API_PREFIX = '/api/';

export interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export type CloudflareRequestCf = Record<string, unknown>;

export type CloudflareContextSource = 'workers' | 'platform-proxy';

export interface CloudflarePlatform<Env = Cloudflare.Env, Cf = CloudflareRequestCf> {
  readonly env: Env;
  readonly ctx: CloudflareExecutionContext;
  readonly cf: Cf | undefined;
}

export interface CloudflareContext<
  Env = Cloudflare.Env,
  Cf = CloudflareRequestCf,
> extends CloudflarePlatform<Env, Cf> {
  readonly source: CloudflareContextSource;
  readonly dispatch: (request: Request) => Promise<Response | null>;
  readonly [CLOUDFLARE_CONTEXT_MARKER]: true;
}

export type ApiResult = Response | null | undefined;

export type ApiHandler<Env = Cloudflare.Env> = (
  request: Request,
  env: Env,
  ctx: CloudflareExecutionContext,
) => ApiResult | Promise<ApiResult>;

export type ApiOption<Env = Cloudflare.Env> = ApiHandler<Env> | { fetch: ApiHandler<Env> };

export interface CloudflareHandlerOptions<Env = Cloudflare.Env> {
  allowedHosts?: readonly string[];
  api?: ApiOption<Env>;
  apiPrefix?: string | false;
  stripProxyHeaders?: boolean;
}

export type RenderFunction = (
  request: Request,
  context: CloudflareContext<any, any> | undefined,
) => Promise<Response | null>;

export type DevPlatformLoader = () => Promise<CloudflarePlatform<any, any> | undefined> | undefined;

export type CloudflareFetchHandler<Env = Cloudflare.Env> = (
  request: Request,
  env?: Env,
  ctx?: CloudflareExecutionContext,
) => Promise<Response>;

const inProcessRequests = new WeakSet<Request>();

export function isInProcessRequest(request: Request): boolean {
  return inProcessRequests.has(request);
}

export function isCloudflareContext(value: unknown): value is CloudflareContext<any, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_MARKER] === true
  );
}

export function resolveAllowedHosts(extra: readonly string[] = []): string[] {
  const hosts: string[] = [];
  for (const host of [...DEFAULT_ALLOWED_HOSTS, ...extra]) {
    const normalized = host.trim().toLowerCase();
    if (normalized && !hosts.includes(normalized)) {
      hosts.push(normalized);
    }
  }
  return hosts;
}

export function isHostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const pattern of allowedHosts) {
    if (pattern === '*') {
      return true;
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1);
      if (host.endsWith(suffix) && host.length > suffix.length) {
        return true;
      }
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

export function hostRefusal(hostname: string): Response {
  return new Response(
    `Host "${hostname}" is not allowed by ngx-cloudflare. ` +
      `Add it to allowedHosts in createCloudflareRequestHandler() in src/server.ts. ` +
      `localhost, 127.0.0.1 and *.workers.dev are allowed by default.`,
    { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export function isProxyHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'forwarded' || lower.startsWith('x-forwarded-');
}

export function stripProxyHeaders(request: Request): Request {
  const names: string[] = [];
  request.headers.forEach((_value, name) => {
    if (isProxyHeader(name)) {
      names.push(name);
    }
  });
  if (names.length === 0) {
    return request;
  }
  const headers = new Headers(request.headers);
  for (const name of names) {
    headers.delete(name);
  }
  return new Request(request, { headers });
}

function toApiHandler<Env>(api: ApiOption<Env> | undefined): ApiHandler<Env> | undefined {
  if (!api) {
    return undefined;
  }
  if (typeof api === 'function') {
    return api;
  }
  return (request, env, ctx) => api.fetch(request, env, ctx);
}

function matchesPrefix(request: Request, prefix: string | false): boolean {
  if (prefix === false) {
    return true;
  }
  const { pathname } = new URL(request.url);
  const bare = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return pathname === bare || pathname.startsWith(bare + '/');
}

const NOOP_CONTEXT: CloudflareExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

export function createCloudflareFetch<Env = Cloudflare.Env>(
  render: RenderFunction,
  options: CloudflareHandlerOptions<Env> = {},
  loadDevPlatform?: DevPlatformLoader,
): CloudflareFetchHandler<Env> {
  const allowedHosts = resolveAllowedHosts(options.allowedHosts);
  const api = toApiHandler(options.api);
  const apiPrefix = options.apiPrefix ?? DEFAULT_API_PREFIX;
  const strip = options.stripProxyHeaders ?? true;
  const refusedHosts = new Set<string>();

  async function callApi(
    request: Request,
    platform: CloudflarePlatform<Env> | undefined,
  ): Promise<Response | null> {
    if (!api || !matchesPrefix(request, apiPrefix)) {
      return null;
    }
    const result = await api(request, platform?.env as Env, platform?.ctx ?? NOOP_CONTEXT);
    return result ?? null;
  }

  async function serveAsset(
    request: Request,
    platform: CloudflarePlatform<Env> | undefined,
  ): Promise<Response | null> {
    const assets = (
      platform?.env as { ASSETS?: { fetch(request: Request): Promise<Response> } } | undefined
    )?.ASSETS;
    if (
      !assets ||
      typeof assets.fetch !== 'function' ||
      (request.method !== 'GET' && request.method !== 'HEAD')
    ) {
      return null;
    }
    const response = await assets.fetch(request);
    return response.status === 404 ? null : response;
  }

  function createContext(
    platform: CloudflarePlatform<Env>,
    source: CloudflareContextSource,
  ): CloudflareContext<Env> {
    return {
      env: platform.env,
      ctx: platform.ctx,
      cf: platform.cf,
      source,
      dispatch: async (request) => {
        inProcessRequests.add(request);
        return (await callApi(request, platform)) ?? (await serveAsset(request, platform));
      },
      [CLOUDFLARE_CONTEXT_MARKER]: true,
    };
  }

  return async (request, env, ctx) => {
    let platform: CloudflarePlatform<Env> | undefined;
    let source: CloudflareContextSource = 'workers';
    if (env !== undefined) {
      platform = {
        env,
        ctx: ctx ?? NOOP_CONTEXT,
        cf: (request as Request & { cf?: CloudflareRequestCf }).cf,
      };
    } else if (loadDevPlatform) {
      platform = await loadDevPlatform();
      source = 'platform-proxy';
    }

    const { hostname } = new URL(request.url);
    if (!isHostAllowed(hostname, allowedHosts)) {
      if (!refusedHosts.has(hostname)) {
        refusedHosts.add(hostname);
        console.error(
          `ngx-cloudflare: refused host "${hostname}". Allowed hosts: ${allowedHosts.join(', ')}`,
        );
      }
      return hostRefusal(hostname);
    }

    const apiResponse = await callApi(request, platform);
    if (apiResponse) {
      return apiResponse;
    }

    const context = platform ? createContext(platform, source) : undefined;
    const response = await render(strip ? stripProxyHeaders(request) : request, context);
    return response ?? new Response('Page not found.', { status: 404 });
  };
}
