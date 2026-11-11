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
import { Observable } from 'rxjs';
import { CLOUDFLARE_CONTEXT_MARKER, type CloudflareContext } from 'ngx-cloudflare/server';

const XSSI_PREFIX = /^\)\]\}',?\n/;

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
    const context = this.cloudflare as CloudflareContext<any, any> | null;
    if (
      !this.incoming ||
      !context ||
      (context as unknown as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT_MARKER] !== true
    ) {
      return super.handle(req);
    }
    const base = new URL(this.incoming.url);
    const url = new URL(req.urlWithParams, base);
    if (url.origin !== base.origin) {
      return super.handle(req);
    }

    return new Observable<HttpEvent<unknown>>((observer) => {
      const aborter = new AbortController();
      let fallback: { unsubscribe(): void } | undefined;
      let finished = false;

      (async () => {
        const response = await context.dispatch(toRequest(req, url, aborter.signal));
        if (aborter.signal.aborted) {
          return;
        }
        if (!response) {
          fallback = super.handle(req).subscribe(observer);
          return;
        }
        observer.next({ type: HttpEventType.Sent });
        const headers = toHeaders(response.headers);
        const { body, parseError } = await readBody(req, response);
        if (aborter.signal.aborted) {
          return;
        }
        const ok = response.status >= 200 && response.status < 300;
        finished = true;
        if (ok && !parseError) {
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
        if (!aborter.signal.aborted) {
          finished = true;
          observer.error(
            new HttpErrorResponse({ error, status: 0, statusText: 'Unknown Error', url: url.href }),
          );
        }
      });

      return () => {
        fallback?.unsubscribe();
        if (!finished) {
          aborter.abort();
        }
      };
    });
  }
}
