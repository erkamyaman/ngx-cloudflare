# Recipes

## Custom domains

List every hostname the Worker answers on in the `ALLOWED_HOSTS` var, next to the routes that point them at the Worker:

```jsonc
{
  "routes": [
    { "pattern": "example.com", "custom_domain": true },
    { "pattern": "www.example.com", "custom_domain": true }
  ],
  "vars": { "ALLOWED_HOSTS": "example.com,www.example.com,*.preview.example.com" }
}
```

`ng add` copies hostnames from `route` and `routes`, including those under `env`, into `ALLOWED_HOSTS`. Run it again after adding routes, or edit the var by hand. Changing the var needs a redeploy but no code change.

You can also pass hosts in code, which is useful when the list depends on something only `server.ts` knows:

```ts
export const reqHandler = createCloudflareRequestHandler<Env>({
  allowedHosts: ['example.com'],
});
```

## A Hono API

```ts
import { Hono } from 'hono';
import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';

const api = new Hono<{ Bindings: Env }>().basePath('/api');
api.get('/entries', async (c) => c.json(await c.env.DB.prepare('SELECT * FROM entries').all()));

export const reqHandler = createCloudflareRequestHandler<Env>({ api });
export default { fetch: reqHandler };
```

Hono answers every path under `/api/`, including its own 404s, so Angular never renders those paths.

## Cron triggers and queues

The handler only covers `fetch`. Export the others next to it:

```ts
export default {
  fetch: reqHandler,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM entries WHERE created_at < ?').bind(cutoff()).run());
  },
  async queue(batch, env) {
    for (const message of batch.messages) message.ack();
  },
} satisfies ExportedHandler<Env>;
```

## Durable Objects

Angular runs `src/server.ts` in Node to extract routes and to serve `ng serve`, and Node cannot load `cloudflare:workers`. Keep the Durable Object in a separate Worker entry that wraps the Angular bundle:

```ts
// worker/index.ts
import { DurableObject } from 'cloudflare:workers';
import app from '../dist/my-app/server/server.mjs';

export class Counter extends DurableObject {
  async increment(): Promise<number> {
    const next = ((await this.ctx.storage.get<number>('n')) ?? 0) + 1;
    await this.ctx.storage.put('n', next);
    return next;
  }
}

export default app;
```

```ts
// worker/server.d.ts
declare module '*/server/server.mjs' {
  const handler: ExportedHandler;
  export default handler;
}
```

```jsonc
// wrangler.jsonc
{
  "main": "./worker/index.ts",
  "durable_objects": { "bindings": [{ "name": "COUNTER", "class_name": "Counter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Counter"] }]
}
```

Keep `worker/` outside the folders your Angular `tsconfig.app.json` includes. Run `ng build` before `wrangler dev` or `wrangler deploy`, as the `preview` and `deploy` scripts already do.

This works in `wrangler dev` and on Workers. Under `ng serve` the binding exists but calls fail, because wrangler's platform proxy cannot run a Durable Object defined in the app's own Worker. Use `npm run preview` while working on Durable Object code.

## Reading bindings in a resolver

```ts
export const entriesResolver: ResolveFn<Entry[]> = async () => {
  const env = injectEnv<Env>();
  if (env) {
    const { results } = await env.DB.prepare('SELECT * FROM entries').all<Entry>();
    return results;
  }
  return firstValueFrom(inject(HttpClient).get<Entry[]>('/api/entries'));
};
```

The browser branch only runs on client-side navigation. With `provideCloudflare()` you can also use the `HttpClient` path on both sides, since the server answers it in-process.

## Unit tests with fake bindings

```ts
TestBed.configureTestingModule({
  providers: [provideCloudflareTesting<Env>({ env: { GREETING: 'hi' } })],
});
```

See [`ngx-cloudflare/testing`](api.md#ngx-cloudflaretesting).

## Turning things off

| To turn off | Option |
| --- | --- |
| Dev bindings in `ng serve` | `devPlatform: false` |
| In-process `HttpClient` calls | `provideCloudflare({ inProcessRequests: false })` |
| Proxy-header removal | `stripProxyHeaders: false` |
| The `/api/` prefix | `apiPrefix: false` (every path tries `api` first) |
