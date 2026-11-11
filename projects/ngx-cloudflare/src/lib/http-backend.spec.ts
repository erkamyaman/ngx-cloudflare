import {
  FetchBackend,
  HttpBackend,
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withFetch,
} from '@angular/common/http';
import { REQUEST, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { CLOUDFLARE_CONTEXT_MARKER } from 'ngx-cloudflare/server';
import { CloudflareFetchBackend } from './http-backend';
import { provideCloudflare } from './provide';

type Dispatch = (request: Request) => Promise<Response | null>;

function setup(dispatch: Dispatch | null, url = 'https://demo.x.workers.dev/page') {
  const network = vi.fn(
    async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({ from: 'network', url: String(input) })),
  );
  vi.stubGlobal('fetch', network);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withFetch()),
      provideCloudflare(),
      { provide: REQUEST, useValue: new Request(url) },
      dispatch
        ? {
            provide: REQUEST_CONTEXT,
            useValue: {
              env: {},
              ctx: {},
              cf: undefined,
              source: 'workers',
              dispatch,
              [CLOUDFLARE_CONTEXT_MARKER]: true,
            },
          }
        : [],
    ],
  });
  return { http: TestBed.inject(HttpClient), network };
}

afterEach(() => vi.unstubAllGlobals());

describe('CloudflareFetchBackend', () => {
  it('replaces both HttpBackend and FetchBackend and is a FetchBackend', () => {
    setup(null);
    const backend = TestBed.inject(HttpBackend);
    expect(backend).toBeInstanceOf(CloudflareFetchBackend);
    expect(backend).toBeInstanceOf(FetchBackend);
    expect(TestBed.inject(FetchBackend)).toBe(backend);
  });

  it('answers same-origin requests in-process', async () => {
    const dispatch = vi.fn<Dispatch>(async (request) =>
      Response.json({ path: new URL(request.url).pathname }),
    );
    const { http, network } = setup(dispatch);

    expect(await firstValueFrom(http.get('/api/entries?limit=2'))).toEqual({
      path: '/api/entries',
    });
    expect(network).not.toHaveBeenCalled();
    expect(dispatch.mock.calls[0][0].url).toBe('https://demo.x.workers.dev/api/entries?limit=2');
  });

  it('accepts absolute same-origin URLs', async () => {
    const { http, network } = setup(async () => Response.json(1));
    expect(await firstValueFrom(http.get('https://demo.x.workers.dev/api/x'))).toBe(1);
    expect(network).not.toHaveBeenCalled();
  });

  it('sends other origins to the network', async () => {
    const dispatch = vi.fn<Dispatch>();
    const { http, network } = setup(dispatch);
    await firstValueFrom(http.get('https://api.example.com/x'));
    expect(dispatch).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('falls back to the network when dispatch returns null', async () => {
    const { http, network } = setup(async () => null);
    expect(await firstValueFrom(http.get<{ from: string }>('/api/unknown'))).toEqual(
      expect.objectContaining({ from: 'network' }),
    );
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('uses the network outside a Cloudflare request', async () => {
    const { http, network } = setup(null);
    await firstValueFrom(http.get('/api/x'));
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('supports text, blob and arraybuffer responses', async () => {
    const { http } = setup(async () => new Response('hello'));
    expect(await firstValueFrom(http.get('/a', { responseType: 'text' }))).toBe('hello');
    expect(await (await firstValueFrom(http.get('/a', { responseType: 'blob' }))).text()).toBe(
      'hello',
    );
    expect(
      new TextDecoder().decode(
        await firstValueFrom(http.get('/a', { responseType: 'arraybuffer' })),
      ),
    ).toBe('hello');
  });

  it('returns null for an empty JSON body and strips the XSSI prefix', async () => {
    let body = '';
    const { http } = setup(async () => new Response(body));
    expect(await firstValueFrom(http.get('/a'))).toBeNull();
    body = ')]}\',\n{"a":1}';
    expect(await firstValueFrom(http.get('/a'))).toEqual({ a: 1 });
  });

  it('turns non-2xx responses into HttpErrorResponse with the body', async () => {
    const { http } = setup(async () =>
      Response.json({ message: 'nope' }, { status: 422, statusText: 'Unprocessable' }),
    );
    const error = await firstValueFrom(http.get('/api/x')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(422);
    expect((error as HttpErrorResponse).error).toEqual({ message: 'nope' });
  });

  it('reports a JSON parse failure on a 2xx response as an error', async () => {
    const { http } = setup(async () => new Response('not json'));
    const error = (await firstValueFrom(http.get('/api/x')).catch(
      (e: unknown) => e,
    )) as HttpErrorResponse;
    expect(error.status).toBe(200);
    expect(error.error.text).toBe('not json');
  });

  it('reports a dispatch failure as status 0', async () => {
    const { http } = setup(async () => {
      throw new Error('boom');
    });
    const error = (await firstValueFrom(http.get('/api/x')).catch(
      (e: unknown) => e,
    )) as HttpErrorResponse;
    expect(error.status).toBe(0);
  });

  it('forwards method, headers and a JSON body', async () => {
    const dispatch = vi.fn<Dispatch>(async (request) =>
      Response.json({
        method: request.method,
        type: request.headers.get('content-type'),
        x: request.headers.get('x-test'),
        body: await request.json(),
      }),
    );
    const { http } = setup(dispatch);
    const result = await firstValueFrom(
      http.post('/api/entries', { name: 'Ada' }, { headers: { 'x-test': '1' } }),
    );
    expect(result).toEqual({
      method: 'POST',
      type: 'application/json',
      x: '1',
      body: { name: 'Ada' },
    });
  });

  it('aborts the in-process request when unsubscribed', async () => {
    let signal: AbortSignal | undefined;
    const { http } = setup((request) => {
      signal = request.signal;
      return new Promise(() => {});
    });
    const subscription = http.get('/api/slow').subscribe();
    await Promise.resolve();
    subscription.unsubscribe();
    expect(signal?.aborted).toBe(true);
  });

  it('returns response headers', async () => {
    const { http } = setup(async () => Response.json({}, { headers: { 'x-total': '5' } }));
    const response = await firstValueFrom(http.get('/api/x', { observe: 'response' }));
    expect(response.headers.get('x-total')).toBe('5');
  });

  it('can be turned off', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch()), provideCloudflare({ inProcessRequests: false })],
    });
    expect(TestBed.inject(HttpBackend)).not.toBeInstanceOf(CloudflareFetchBackend);
  });
});
