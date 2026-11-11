import type { HttpHeaders } from '@angular/common/http';
import type { CloudflareContext } from 'ngx-cloudflare';
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
  visitsBefore: number;
  visit: number;
  renderedAt: string;
}

export interface EntriesMeta {
  servedVia: string | null;
  d1Ms: number | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function createRequestTrace(
  request: Request,
  cloudflare: CloudflareContext<object>,
  visitsBefore: number,
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
    colo: text(cf['colo']),
    country: text(cf['country']),
    protocol: text(cf['httpProtocol']),
    tls: text(cf['tlsVersion']),
    visitsBefore,
    visit: visitsBefore + 1,
    renderedAt: new Date().toISOString(),
  };
}

export function readEntriesMeta(headers: HttpHeaders): EntriesMeta {
  const match = /d1;dur=([\d.]+)/.exec(headers.get('server-timing') ?? '');
  return { servedVia: headers.get('x-served-via'), d1Ms: match ? Number(match[1]) : null };
}
