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

## Caching pages

Pages are rendered on every request by default. To keep a rendered page at the edge, give its route a shared max-age and turn on `cachePages`:

```ts
// src/app/app.routes.server.ts
export const serverRoutes: ServerRoute[] = [
  { path: 'blog/**', renderMode: RenderMode.Server, headers: { 'Cache-Control': 'public, s-maxage=300' } },
  { path: '**', renderMode: RenderMode.Server },
];
```

```ts
// src/server.ts
export const reqHandler = createCloudflareRequestHandler<Env>({ api, cachePages: true });
```

The handler stores a page in the Workers Cache API (`caches.default`) when the response is a 200 with a positive `max-age` or `s-maxage`, no `private`, `no-store` or `no-cache`, and no `Set-Cookie`. It looks a page up, and stores it, only for `GET` requests without a `Cookie` or `Authorization` header, because those pages may be personal. The cache key is the full URL, query string included. Calls under `apiPrefix` are never cached by this option.

Things to know:

- The Cache API stores nothing on `*.workers.dev`. Caching takes effect on a custom domain, and locally under `wrangler dev`, where the second request shows `CF-Cache-Status: HIT`.
- `ng serve` never uses the cache.
- The cache is per Cloudflare data centre, and a deploy does not clear it. Keep `s-maxage` short, or purge from the dashboard after a release.
- A cached page carries its transfer state, so the data it shows is as old as the page.

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

Angular runs `src/server.ts` in Node to extract routes and to serve `ng serve`, and Node cannot load `cloudflare:workers`. So the Durable Object class cannot live in `src/server.ts`. There are two ways to keep it elsewhere.

### In its own Worker (works in `ng serve`)

Put the class in a small Worker with its own config, and bind to it by `script_name`:

```ts
// worker/counter.ts
import { DurableObject } from 'cloudflare:workers';

export class Counter extends DurableObject {
  async increment(): Promise<number> {
    const next = ((await this.ctx.storage.get<number>('n')) ?? 0) + 1;
    await this.ctx.storage.put('n', next);
    return next;
  }
}

export default { fetch: () => new Response('counter') };
```

```jsonc
// worker/counter.wrangler.jsonc
{
  "name": "my-app-counter",
  "main": "./counter.ts",
  "compatibility_date": "2026-11-11",
  "durable_objects": { "bindings": [{ "name": "COUNTER", "class_name": "Counter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Counter"] }]
}
```

```jsonc
// wrangler.jsonc (the Angular app)
{
  "durable_objects": {
    "bindings": [{ "name": "COUNTER", "class_name": "Counter", "script_name": "my-app-counter" }]
  }
}
```

In development, start the counter Worker next to the app. Wrangler's dev registry connects them, so `env.COUNTER` works in `ng serve` and in `wrangler dev`, and both share its state:

```bash
npx wrangler dev -c worker/counter.wrangler.jsonc --port 8788
npm start
```

To deploy, deploy the counter Worker first, then the app:

```bash
npx wrangler deploy -c worker/counter.wrangler.jsonc
npm run deploy
```

Keep `worker/` outside the folders your Angular `tsconfig.app.json` includes. The cost of this layout is a second Worker to deploy and keep in step with the app.

### In the app's Worker (no `ng serve`)

Wrap the Angular bundle in a Worker entry that also exports the class, so there is only one Worker:

```ts
// worker/index.ts
export { Counter } from './counter';
import app from '../dist/my-app/server/server.mjs';
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

Run `ng build` before `wrangler dev` or `wrangler deploy`, as the `preview` and `deploy` scripts already do. This works in `wrangler dev` and on Workers. Under `ng serve` the binding exists but calls fail, because wrangler's platform proxy cannot run a Durable Object defined in the app's own Worker. Use `npm run preview` while working on Durable Object code, or switch to the layout above.

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
