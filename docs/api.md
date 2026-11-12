# API

ngx-cloudflare has three entry points.

| Import | Runs in | Contents |
| --- | --- | --- |
| `ngx-cloudflare/server` | `src/server.ts` | The Worker request handler, the hostname policy, and the context types. The core has no Angular imports. |
| `ngx-cloudflare` | Angular code | Inject functions and `provideCloudflare()`. |
| `ngx-cloudflare/testing` | Unit tests | Fake bindings for TestBed. |

## `ngx-cloudflare/server`

### `createCloudflareRequestHandler(options?)`

Returns the function to export as `reqHandler` and as `fetch`. On Workers it receives `(request, env, ctx)`. Under `ng serve` the Angular dev server calls it with the request only, and the bindings come from wrangler's `getPlatformProxy()`.

```ts
export const reqHandler = createCloudflareRequestHandler<Env>(options);
export default { fetch: reqHandler, scheduled, queue } satisfies ExportedHandler<Env>;
```

Other handlers (`scheduled`, `queue`, `email`) stay yours: export them next to `fetch`.

| Option | Default | What it does |
| --- | --- | --- |
| `allowedHosts` | `[]` | Hostnames to accept on top of `localhost`, `127.0.0.1` and `*.workers.dev`, and on top of the `ALLOWED_HOSTS` var. `*.example.com` matches subdomains, not `example.com` itself. `'*'` accepts every host and must be added on purpose. |
| `api` | none | A function `(request, env, ctx) => Response \| null`, or an object with a `fetch` method such as a Hono app. Return `null` or `undefined` to let Angular render the path. |
| `apiPrefix` | `'/api/'` | Which paths go to `api`. `false` sends every path to `api` first. |
| `cachePages` | `false` | Keep rendered pages in the Workers Cache API when their `Cache-Control` allows it. See [Caching pages](recipes.md#caching-pages). |
| `stripProxyHeaders` | `true` | Remove `forwarded` and `x-forwarded-*` before Angular sees the request. The `api` handler still gets them. |
| `devPlatform` | `{}` | Options for `getPlatformProxy()` under `ng serve`: `configPath`, `environment`, `persist`. `false` turns dev bindings off. |

The handler also reads the `ALLOWED_HOSTS` var from `env`: a comma- or space-separated list in the `vars` of `wrangler.jsonc`. `ng add` fills it from your routes.

Requests are handled in this order:

1. The host is checked. A refused host gets HTTP 400 naming the option to change, and one log line per host.
2. Paths under `apiPrefix` go to `api`.
3. With `cachePages`, a `GET` without cookies or `Authorization` is answered from the cache when it has the page.
4. Everything else is rendered by Angular, with the Cloudflare context as `REQUEST_CONTEXT`. No page means HTTP 404.

Static files never reach the handler: Workers serves them from the `assets` directory first.

### `createCloudflareFetch(render, options?, loadDevPlatform?)`

The Angular-free core that `createCloudflareRequestHandler` wraps. Use it to plug in a different renderer or to unit-test your own setup in plain Node.

### Helpers

| Export | Purpose |
| --- | --- |
| `resolveAllowedHosts(extra)` | The final allow-list: defaults plus `extra`, lower-cased and de-duplicated. |
| `isHostAllowed(hostname, hosts)` | The matching rule used by the handler. |
| `isCacheablePageRequest(request)` | Whether `cachePages` may answer a request from the cache: a `GET` without `Cookie` or `Authorization`. |
| `isCacheablePageResponse(response)` | Whether `cachePages` would store a rendered page: status 200, no `Set-Cookie`, and a `max-age` or `s-maxage` above 0 without `private`, `no-store` or `no-cache`. |
| `stripProxyHeaders(request)` | Returns the request without proxy headers, or the same request if it had none. |
| `hostsFromEnv(env)` | The hostnames listed in `env.ALLOWED_HOSTS`. |
| `isInProcessRequest(request)` | Whether `api` received the request through `dispatch` during rendering rather than over the network. The flag lives in memory, so a client cannot fake it with a header. |

### `CloudflareContext<Env, Cf>`

What Angular receives as `REQUEST_CONTEXT`:

| Field | Type | Notes |
| --- | --- | --- |
| `env` | `Env` | Your bindings. Defaults to the `Cloudflare.Env` interface that `wrangler types` generates. |
| `ctx` | `CloudflareExecutionContext` | `waitUntil()` and `passThroughOnException()`. A no-op under `ng serve`. |
| `cf` | `Cf \| undefined` | `request.cf`. Under `ng serve` it is wrangler's mock. |
| `source` | `'workers' \| 'platform-proxy'` | Where the bindings came from. |
| `dispatch` | `(request) => Promise<Response \| null>` | Answers a same-origin request in-process: first `api`, then the `ASSETS` binding for `GET` and `HEAD`. `null` means neither handled it. |

## `ngx-cloudflare`

### Inject functions

Call them where `inject()` works: constructors, field initialisers, factory providers, functional guards and resolvers.

| Function | Returns |
| --- | --- |
| `injectCloudflare<Env, Cf>()` | The whole `CloudflareContext`. |
| `injectEnv<Env>()` | `env`. |
| `injectExecutionContext()` | `ctx`. |
| `injectRequestCf<Cf>()` | `request.cf`. |

Each returns `null` outside a server request: in the browser, while prerendering, and at build time. With `{ required: true }` it throws an error that says why instead, and the return type drops `null`.

Async work in a component should run through `PendingTasks` so the page waits for it before it is sent:

```ts
const env = injectEnv<Env>();
if (env) {
  inject(PendingTasks).run(async () => this.count.set(Number(await env.VISITS.get('count'))));
}
```

### `provideCloudflare(options?)`

Add it to the server application config, after `provideServerRendering()`. It installs an `HttpClient` backend that answers `HttpClient` calls to the page's own origin through `context.dispatch` instead of the network. Other origins, and requests nothing handled in-process, still go over the network. Because it sits where Angular's backend sits, the transfer cache records the responses and the browser does not request them again.

The backend extends Angular's `FetchBackend`, so Angular's NG02801 warning stays quiet.

| Option | Default | What it does |
| --- | --- | --- |
| `inProcessRequests` | `true` | `false` leaves `HttpClient` untouched. |

Supported in-process: every method, JSON, text, blob and arraybuffer responses, request bodies, headers, non-2xx responses as `HttpErrorResponse`, and cancellation.

## `ngx-cloudflare/testing`

```ts
TestBed.configureTestingModule({
  providers: [
    provideCloudflareTesting<Env>({
      env: { GREETING: 'hi' },
      cf: { country: 'TR' },
      url: 'https://app.test/',
      api: (request, env) => Response.json({ ok: true }),
    }),
  ],
});
```

| Export | Purpose |
| --- | --- |
| `provideCloudflareTesting(options)` | Provides `REQUEST_CONTEXT` and `REQUEST` with fake bindings. Add `provideCloudflare()` too to test in-process `HttpClient` calls through `api`. |
| `createCloudflareTestContext(options)` | The same context without TestBed. |
| `createCloudflareTestExecutionContext()` | A `ctx` that records `waitUntil` promises in `waitUntilPromises`. |

## Private exports

Names starting with `ɵ` (`ɵCloudflareFetchBackend`, `ɵisCloudflareContext`, `ɵtoApiHandler`, `ɵcallInProcess`, `ɵCLOUDFLARE_CONTEXT_MARKER`) are shared between the package's own entry points. They are exported only for that reason, as in Angular itself, and may change in any release.
