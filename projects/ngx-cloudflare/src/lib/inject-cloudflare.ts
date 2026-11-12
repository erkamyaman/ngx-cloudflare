import { assertInInjectionContext, inject, REQUEST_CONTEXT } from '@angular/core';
import {
  ɵisCloudflareContext,
  type CloudflareContext,
  type CloudflareExecutionContext,
  type CloudflareRequestCf,
} from 'ngx-cloudflare/server';

export interface InjectCloudflareOptions {
  required?: boolean;
}

const MISSING_CONTEXT =
  'ngx-cloudflare: no Cloudflare request context. Bindings exist only while a request is rendered on the server ' +
  '(on Workers or in ng serve). They are null in the browser, during prerendering and at build time. ' +
  'Check that src/server.ts uses createCloudflareRequestHandler(), or call this without { required: true } and handle null.';

function readContext(fn: Function): CloudflareContext<any, any> | null {
  assertInInjectionContext(fn);
  const value = inject(REQUEST_CONTEXT, { optional: true });
  return ɵisCloudflareContext(value) ? value : null;
}

function orThrow<T>(value: T | null, options: InjectCloudflareOptions | undefined): T | null {
  if (value === null && options?.required) {
    throw new Error(MISSING_CONTEXT);
  }
  return value;
}

export function injectCloudflare<Env = Cloudflare.Env, Cf = CloudflareRequestCf>(options: {
  required: true;
}): CloudflareContext<Env, Cf>;
export function injectCloudflare<Env = Cloudflare.Env, Cf = CloudflareRequestCf>(
  options?: InjectCloudflareOptions,
): CloudflareContext<Env, Cf> | null;
export function injectCloudflare(
  options?: InjectCloudflareOptions,
): CloudflareContext<any, any> | null {
  return orThrow(readContext(injectCloudflare), options);
}

export function injectEnv<Env = Cloudflare.Env>(options: { required: true }): Env;
export function injectEnv<Env = Cloudflare.Env>(options?: InjectCloudflareOptions): Env | null;
export function injectEnv(options?: InjectCloudflareOptions): unknown {
  return orThrow(readContext(injectEnv)?.env ?? null, options);
}

export function injectExecutionContext(options: { required: true }): CloudflareExecutionContext;
export function injectExecutionContext(
  options?: InjectCloudflareOptions,
): CloudflareExecutionContext | null;
export function injectExecutionContext(
  options?: InjectCloudflareOptions,
): CloudflareExecutionContext | null {
  return orThrow(readContext(injectExecutionContext)?.ctx ?? null, options);
}

export function injectRequestCf<Cf = CloudflareRequestCf>(options: { required: true }): Cf;
export function injectRequestCf<Cf = CloudflareRequestCf>(
  options?: InjectCloudflareOptions,
): Cf | null;
export function injectRequestCf(options?: InjectCloudflareOptions): unknown {
  return orThrow(readContext(injectRequestCf)?.cf ?? null, options);
}
