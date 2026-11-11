import { Injector, REQUEST_CONTEXT, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CLOUDFLARE_CONTEXT_MARKER } from 'ngx-cloudflare/server';
import { injectCloudflare, injectEnv, injectExecutionContext, injectRequestCf } from './inject';

const ctx = { waitUntil() {}, passThroughOnException() {} };
const context = {
  env: { GREETING: 'hello' },
  ctx,
  cf: { country: 'TR' },
  source: 'workers',
  dispatch: async () => null,
  [CLOUDFLARE_CONTEXT_MARKER]: true,
};

function run<T>(fn: () => T, value?: unknown): T {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: value === undefined ? [] : [{ provide: REQUEST_CONTEXT, useValue: value }],
  });
  return runInInjectionContext(TestBed.inject(Injector), fn);
}

describe('inject functions', () => {
  it('read env, ctx and cf from the request context', () => {
    expect(run(() => injectEnv<{ GREETING: string }>(), context)?.GREETING).toBe('hello');
    expect(run(() => injectExecutionContext(), context)).toBe(ctx);
    expect(run(() => injectRequestCf(), context)).toEqual({ country: 'TR' });
    expect(run(() => injectCloudflare(), context)?.source).toBe('workers');
  });

  it('return null outside a request', () => {
    expect(run(() => injectEnv())).toBeNull();
    expect(run(() => injectCloudflare())).toBeNull();
    expect(run(() => injectExecutionContext())).toBeNull();
    expect(run(() => injectRequestCf())).toBeNull();
  });

  it('ignore request contexts that are not from ngx-cloudflare', () => {
    expect(run(() => injectEnv(), { env: { X: 1 } })).toBeNull();
  });

  it('throw a clear error in the required variant', () => {
    expect(() => run(() => injectEnv({ required: true }))).toThrow(/no Cloudflare request context/);
    expect(() => run(() => injectCloudflare({ required: true }))).toThrow(
      /createCloudflareRequestHandler/,
    );
    expect(run(() => injectEnv({ required: true }), context)).toEqual({ GREETING: 'hello' });
  });

  it('must be called in an injection context', () => {
    expect(() => injectEnv()).toThrow();
  });
});
