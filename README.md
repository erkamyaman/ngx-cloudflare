<h1 align="center">ngx-cloudflare</h1>
<p align="center">
  <img src="https://img.shields.io/maintenance/yes/2026?style=for-the-badge" alt="Maintained: yes" />
  <img src="https://img.shields.io/badge/angular-19%20to%2022-dd0031?style=for-the-badge&logo=angular&logoColor=white" alt="Angular 19 to 22" />
  <img src="https://img.shields.io/badge/cloudflare-workers-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <a href="https://github.com/erkamyaman/ngx-cloudflare/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/erkamyaman/ngx-cloudflare/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT" /></a>
  <a href="https://github.com/sponsors/erkamyaman"><img src="https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor" /></a>
</p>
<p align="center">
Workers bindings, a working hostname allow-list and in-process API calls for Angular SSR apps on Cloudflare Workers, in <code>ng serve</code> and in production.
</p>

<table align="center">
  <tr>
    <td align="center"><a href="docs/api.md"><strong>API</strong></a></td>
    <td align="center"><a href="docs/recipes.md">Recipes</a></td>
    <td align="center"><a href="docs/troubleshooting.md">Troubleshooting</a></td>
    <td align="center"><a href="#the-demo">Demo</a></td>
  </tr>
</table>

> [!NOTE]
> Version 0.2.0 is not on npm yet. Function names may still change before it is.

## Why

Cloudflare's Angular starter gets an app onto Workers, but four things break once it is real:

| Problem | Without ngx-cloudflare | With it |
| --- | --- | --- |
| Hostnames | The generated `server.ts` allows only `localhost`, so Angular answers `400 Header "host" ... is not allowed` on your `*.workers.dev` address and custom domains. | `localhost`, `127.0.0.1`, `*.workers.dev` and your wrangler routes are allowed. Anything else gets a 400 that says where to add it. |
| Bindings | `env`, `ctx` and `request.cf` never reach Angular code, and `ng serve` has no bindings at all. | `injectEnv()` and friends, on Workers and in `ng serve`, sharing local state with `wrangler dev`. |
| Own-API calls | During rendering, `HttpClient.get('/api/...')` leaves the Worker and fetches its own hostname. | Answered inside the Worker, and Angular's transfer cache still hands the result to the browser. |
| Log noise | Angular logs a warning for every `x-forwarded-*` header Cloudflare adds, on every request. | Those headers are removed before Angular sees them. |

## Install

```bash
ng add ngx-cloudflare
```

Run it on an app with server-side rendering (`ng new --ssr`, or after `ng add @angular/ssr`). It also works on projects made by `npm create cloudflare` and `wrangler setup`. It:

- points the build at Workers (`outputMode: server`, the neutral SSR platform, `wrangler` kept out of the bundle),
- replaces a stock `src/server.ts` (Angular's Express server or Cloudflare's template) and never touches one you customised,
- registers `provideCloudflare()` in the server config,
- creates `wrangler.jsonc`, or repairs one that deploys the app as a static site,
- switches the stock prerender-everything route to per-request rendering,
- adds `preview`, `deploy` and `cf-typegen` scripts and removes the broken `serve:ssr` one.

| Angular | Platform key it sets | Notes |
| --- | --- | --- |
| 22 | `ssr.platform` | |
| 21 | `ssr.experimentalPlatform` | |
| 20 | `ssr.experimentalPlatform` | |
| 19 | `ssr.experimentalPlatform` | Apps created without server routing are converted: `ng add` adds `app.routes.server.ts` and registers it. |
| 18 and older | | Not supported. `AngularAppEngine` and `REQUEST_CONTEXT`, which this builds on, arrived in 19. |

None of them needs the `nodejs_compat` flag.

## Usage

`src/server.ts` after `ng add`:

```ts
import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';

export const reqHandler = createCloudflareRequestHandler<Env>({
  allowedHosts: ['shop.example.com'],
  api: (request, env, ctx) => {
    if (new URL(request.url).pathname === '/api/hello') {
      return Response.json({ hello: env.GREETING });
    }
    return null;
  },
});

export default { fetch: reqHandler } satisfies ExportedHandler<Env>;
```

`api` takes a function or anything with a `fetch` method, such as a [Hono](https://hono.dev) app. It receives requests under `/api/`. Return `null` to let Angular handle the path.

In components, services, resolvers and guards:

```ts
import { injectEnv, injectExecutionContext, injectRequestCf } from 'ngx-cloudflare';

export class Visits {
  private readonly env = injectEnv<Env>(); // null in the browser

  constructor() {
    const ctx = injectExecutionContext();
    if (this.env && ctx) {
      ctx.waitUntil(this.env.VISITS.put('last', new Date().toISOString()));
    }
  }
}
```

Each function returns `null` outside a server request: in the browser, while prerendering and at build time. Pass `{ required: true }` to throw a clear error instead.

Run `npm run cf-typegen` after editing `wrangler.jsonc` to regenerate the `Env` type.

## Develop and deploy

```bash
ng serve          # bindings from wrangler's local platform proxy
npm run preview   # production build in the local Workers runtime
npm run deploy    # production build, then wrangler deploy
```

`ng serve` and `wrangler dev` share local state in `.wrangler/`, so data you add in one shows up in the other.

## The demo

This repository is an Angular workspace. The root app is a guestbook that runs on the library: entries in D1, a visit counter in KV, and a form posting to `/api/entries`. It doubles as the end-to-end test target.

```bash
npm ci
npm run build:lib
npm run db:migrate   # create the local D1 table
npm start            # or: npm run preview
```

## Tests

```bash
npm run test:lib                          # library: server core, inject functions, HTTP backend, ng add
npx ng test ngx-cloudflare-demo           # demo
scripts/e2e-ng-add.sh 22 <package.tgz>    # fresh app, ng add, wrangler dev and ng serve checks
```

CI runs all of them, and the end-to-end script on Angular 19, 20, 21 and 22.

## Limits

- Durable Objects and anything else that imports `cloudflare:workers` cannot live in `src/server.ts`, because Angular runs that file in Node. See the [Durable Objects recipe](docs/recipes.md#durable-objects).
- Routes rendered at build time (`RenderMode.Prerender`) have no bindings.
- Cloudflare Pages and Analog are not supported. Analog reaches Workers through Nitro's own preset.

## Roadmap

| Next | Why |
| --- | --- |
| Durable Objects in `ng serve` | The recipe works in `wrangler dev` and on Workers, but the platform proxy cannot run an internal Durable Object. |
| Workers beside an existing Node server | A separate build configuration, so adopting this does not replace a working deployment. |
| Bindings during prerendering | Build-time rendering has no request to carry them. |
| Typed helpers for queues and cron | `scheduled` and `queue` exports already work next to `fetch`; helpers would add types. |

## Trademarks and licence

MIT licensed, see [LICENSE](LICENSE).

Cloudflare and Cloudflare Workers are trademarks of Cloudflare, Inc. Angular is a trademark of Google LLC. This project is not affiliated with, endorsed by, or sponsored by either.
