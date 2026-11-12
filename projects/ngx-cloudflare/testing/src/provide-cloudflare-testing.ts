import {
  EnvironmentProviders,
  makeEnvironmentProviders,
  REQUEST,
  REQUEST_CONTEXT,
} from '@angular/core';
import {
  ApiOption,
  ɵcallInProcess,
  ɵCLOUDFLARE_CONTEXT_MARKER,
  type CloudflareContext,
  type CloudflareContextSource,
  type CloudflareExecutionContext,
  type CloudflareRequestCf,
  ɵtoApiHandler,
} from 'ngx-cloudflare/server';

export interface CloudflareTestingOptions<Env = Cloudflare.Env, Cf = CloudflareRequestCf> {
  env?: Partial<Env>;
  cf?: Cf;
  ctx?: Partial<CloudflareExecutionContext>;
  url?: string;
  api?: ApiOption<Env>;
  source?: CloudflareContextSource;
}

export interface TestExecutionContext extends CloudflareExecutionContext {
  readonly waitUntilPromises: Promise<unknown>[];
}

export function createCloudflareTestExecutionContext(
  overrides: Partial<CloudflareExecutionContext> = {},
): TestExecutionContext {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    waitUntilPromises,
    waitUntil: (promise) => {
      waitUntilPromises.push(promise);
    },
    passThroughOnException: () => {},
    ...overrides,
  };
}

export function createCloudflareTestContext<Env = Cloudflare.Env, Cf = CloudflareRequestCf>(
  options: CloudflareTestingOptions<Env, Cf> = {},
): CloudflareContext<Env, Cf> {
  const env = (options.env ?? {}) as Env;
  const ctx = createCloudflareTestExecutionContext(options.ctx);
  const handler = ɵtoApiHandler(options.api);
  return {
    env,
    ctx,
    cf: options.cf,
    source: options.source ?? 'workers',
    dispatch: async (request) => (handler ? ɵcallInProcess(handler, request, env, ctx) : null),
    [ɵCLOUDFLARE_CONTEXT_MARKER]: true,
  };
}

export function provideCloudflareTesting<Env = Cloudflare.Env, Cf = CloudflareRequestCf>(
  options: CloudflareTestingOptions<Env, Cf> = {},
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: REQUEST_CONTEXT, useValue: createCloudflareTestContext(options) },
    { provide: REQUEST, useValue: new Request(options.url ?? 'http://localhost/') },
  ]);
}
