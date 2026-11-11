import type { CloudflareContext } from 'ngx-cloudflare';
import type { VisitRecord } from './visit-log';
import { isHostAllowed, resolveAllowedHosts } from 'ngx-cloudflare/server';

export interface RequestTrace {
  method: string;
  path: string;
  ray: string | null;
  host: string;
  matched: string;
  bindings: string[];
  source: 'workers' | 'platform-proxy';
  colo: string | null;
  country: string | null;
  protocol: string | null;
  tls: string | null;
  visit: VisitRecord;
  renderedAt: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function createRequestTrace(
  request: Request,
  cloudflare: CloudflareContext<object>,
  visit: VisitRecord,
): RequestTrace {
  const url = new URL(request.url);
  const matched = resolveAllowedHosts().find((pattern) => isHostAllowed(url.hostname, [pattern]));
  const cf = cloudflare.cf ?? {};
  return {
    method: request.method,
    path: url.pathname,
    ray: request.headers.get('cf-ray'),
    host: url.hostname,
    matched: matched ?? url.hostname,
    bindings: Object.keys(cloudflare.env).sort(),
    source: cloudflare.source,
    colo: nonEmptyString(cf['colo']),
    country: nonEmptyString(cf['country']),
    protocol: nonEmptyString(cf['httpProtocol']),
    tls: nonEmptyString(cf['tlsVersion']),
    visit,
    renderedAt: new Date().toISOString(),
  };
}
