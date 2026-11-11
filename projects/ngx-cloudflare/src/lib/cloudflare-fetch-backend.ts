import {
  FetchBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject, Injectable, REQUEST, REQUEST_CONTEXT } from '@angular/core';
import { Observable, type Subscription } from 'rxjs';
import { isCloudflareContext } from 'ngx-cloudflare/server';

const XSSI_PREFIX = /^\)\]\}',?\n/;

type DispatchPhase =
  | { kind: 'dispatching' }
  | { kind: 'fallback'; subscription: Subscription }
  | { kind: 'done' }
  | { kind: 'cancelled' };

function toHeaders(headers: Headers): HttpHeaders {
  let result = new HttpHeaders();
  headers.forEach((value, name) => {
    result = result.append(name, value);
  });
  return result;
}

function toRequest(req: HttpRequest<unknown>, url: URL, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const name of req.headers.keys()) {
    for (const value of req.headers.getAll(name) ?? []) {
      headers.append(name, value);
    }
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'application/json, text/plain, */*');
  }
  const body = req.serializeBody();
  if (body !== null && !headers.has('content-type')) {
    const detected = req.detectContentTypeHeader();
    if (detected !== null) {
      headers.set('content-type', detected);
    }
  }
  const hasBody = body !== null && req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (body as BodyInit) : undefined,
    signal,
  });
}

async function readBody(
  req: HttpRequest<unknown>,
  res: Response,
): Promise<{ body: unknown; parseError?: unknown }> {
  switch (req.responseType) {
    case 'arraybuffer':
      return { body: await res.arrayBuffer() };
    case 'blob':
      return { body: await res.blob() };
    case 'text':
      return { body: await res.text() };
    default: {
      const text = await res.text();
      if (text === '') {
        return { body: null };
      }
      try {
        return { body: JSON.parse(text.replace(XSSI_PREFIX, '')) };
      } catch (parseError) {
        return { body: text, parseError };
      }
    }
  }
}

@Injectable()
export class CloudflareFetchBackend extends FetchBackend {
  private readonly cloudflare = inject(REQUEST_CONTEXT, { optional: true });
  private readonly incoming = inject(REQUEST, { optional: true });

  override handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    const context = this.cloudflare;
    if (!this.incoming || !isCloudflareContext(context)) {
      return super.handle(req);
    }
    const base = new URL(this.incoming.url);
    const url = new URL(req.urlWithParams, base);
    if (url.origin !== base.origin) {
      return super.handle(req);
    }

    return new Observable<HttpEvent<unknown>>((observer) => {
      const aborter = new AbortController();
      let phase: DispatchPhase = { kind: 'dispatching' };

      const settle = (next: DispatchPhase): boolean => {
        if (phase.kind !== 'dispatching') {
          return false;
        }
        phase = next;
        return true;
      };

      (async () => {
        const response = await context.dispatch(toRequest(req, url, aborter.signal));
        if (phase.kind !== 'dispatching') {
          return;
        }
        if (!response) {
          const subscription = super.handle(req).subscribe(observer);
          if (!settle({ kind: 'fallback', subscription })) {
            subscription.unsubscribe();
          }
          return;
        }
        observer.next({ type: HttpEventType.Sent });
        const headers = toHeaders(response.headers);
        const { body, parseError } = await readBody(req, response);
        if (!settle({ kind: 'done' })) {
          return;
        }
        if (response.status >= 200 && response.status < 300 && !parseError) {
          observer.next(
            new HttpResponse({
              body,
              headers,
              status: response.status,
              statusText: response.statusText,
              url: url.href,
            }),
          );
          observer.complete();
        } else {
          observer.error(
            new HttpErrorResponse({
              error: parseError ? { error: parseError, text: body } : body,
              headers,
              status: response.status,
              statusText: response.statusText,
              url: url.href,
            }),
          );
        }
      })().catch((error: unknown) => {
        if (settle({ kind: 'done' })) {
          observer.error(
            new HttpErrorResponse({ error, status: 0, statusText: 'Unknown Error', url: url.href }),
          );
        }
      });

      return () => {
        if (phase.kind === 'fallback') {
          phase.subscription.unsubscribe();
        } else if (settle({ kind: 'cancelled' })) {
          aborter.abort();
        }
      };
    });
  }
}
