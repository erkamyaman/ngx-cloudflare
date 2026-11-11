import { HttpClient, provideHttpClient, withFetch } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { injectEnv, injectExecutionContext, provideCloudflare } from 'ngx-cloudflare';
import { isInProcessRequest } from 'ngx-cloudflare/server';
import {
  createCloudflareTestContext,
  provideCloudflareTesting,
  type TestExecutionContext,
} from './provide-cloudflare-testing';

describe('provideCloudflareTesting', () => {
  it('gives injectEnv() fake bindings', () => {
    TestBed.configureTestingModule({
      providers: [provideCloudflareTesting({ env: { GREETING: 'hi' } })],
    });
    const env = TestBed.runInInjectionContext(() => injectEnv<{ GREETING: string }>());
    expect(env?.GREETING).toBe('hi');
  });

  it('records waitUntil promises', () => {
    TestBed.configureTestingModule({ providers: [provideCloudflareTesting()] });
    const ctx = TestBed.runInInjectionContext(() =>
      injectExecutionContext(),
    ) as TestExecutionContext;
    const work = Promise.resolve(1);
    ctx.waitUntil(work);
    expect(ctx.waitUntilPromises).toEqual([work]);
  });

  it('answers own API calls in-process through the api option', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideCloudflare(),
        provideCloudflareTesting<{ N: number }>({
          env: { N: 2 },
          url: 'https://app.test/',
          api: (_request, env) => Response.json({ n: env.N }),
        }),
      ],
    });
    expect(await firstValueFrom(TestBed.inject(HttpClient).get('/api/n'))).toEqual({ n: 2 });
  });

  it('marks requests sent through dispatch as in-process', async () => {
    let seen = false;
    const context = createCloudflareTestContext({
      api: (request) => {
        seen = isInProcessRequest(request);
        return new Response('ok');
      },
    });
    await context.dispatch(new Request('http://localhost/api'));
    expect(seen).toBe(true);
  });

  it('builds a context for code outside Angular', async () => {
    const context = createCloudflareTestContext({ api: { fetch: () => new Response('ok') } });
    expect(await (await context.dispatch(new Request('http://localhost/api')))!.text()).toBe('ok');
  });
});
