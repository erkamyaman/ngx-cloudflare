import { AngularAppEngine, createRequestHandler } from '@angular/ssr';
import {
  CloudflareFetchHandler,
  CloudflareHandlerOptions,
  CloudflarePlatform,
  createCloudflareFetch,
  hostsFromEnv,
  resolveAllowedHosts,
} from './cloudflare-fetch';

declare const ngDevMode: boolean | undefined;

export interface DevPlatformOptions {
  configPath?: string;
  environment?: string;
  persist?: boolean | { path: string };
}

export interface CloudflareRequestHandlerOptions<
  Env = Cloudflare.Env,
> extends CloudflareHandlerOptions<Env> {
  devPlatform?: DevPlatformOptions | false;
}

interface ProxyCache {
  __ngxCloudflarePlatformProxy?: Promise<CloudflarePlatform<any, any> | undefined>;
}

function loadPlatformProxy(
  options: DevPlatformOptions,
): Promise<CloudflarePlatform<any, any> | undefined> {
  const cache = globalThis as ProxyCache;
  cache.__ngxCloudflarePlatformProxy ??= import('wrangler')
    .then((wrangler) => wrangler.getPlatformProxy(options))
    .then((proxy) => ({ env: proxy.env, ctx: proxy.ctx, cf: proxy.cf }))
    .catch((error: unknown) => {
      cache.__ngxCloudflarePlatformProxy = undefined;
      console.error(
        "ngx-cloudflare: could not start wrangler's platform proxy, so bindings are unavailable in ng serve. " +
          'Install wrangler as a dev dependency and check wrangler.jsonc. The next request tries again.',
        error,
      );
      return undefined;
    });
  return cache.__ngxCloudflarePlatformProxy;
}

export function createCloudflareRequestHandler<Env = Cloudflare.Env>(
  options: CloudflareRequestHandlerOptions<Env> = {},
): CloudflareFetchHandler<Env> {
  let engine: AngularAppEngine | undefined;
  const devPlatform = options.devPlatform;

  const handler = createCloudflareFetch<Env>(
    (request, context) => {
      engine ??= new AngularAppEngine({
        allowedHosts: resolveAllowedHosts([
          ...(options.allowedHosts ?? []),
          ...hostsFromEnv(context?.env),
        ]),
      });
      return engine.handle(request, context);
    },
    options,
    () => {
      if ((typeof ngDevMode === 'undefined' || ngDevMode) && devPlatform !== false) {
        return loadPlatformProxy(devPlatform ?? {});
      }
      return undefined;
    },
  );

  createRequestHandler(handler as (request: Request) => Promise<Response>);
  return handler;
}
