<h1 align="center">ngx-cloudflare</h1>
<p align="center">
  <img src="https://img.shields.io/maintenance/yes/2026?style=for-the-badge" alt="Maintained: yes" />
  <img src="https://img.shields.io/badge/angular-21%20%7C%2022-dd0031?style=for-the-badge&logo=angular&logoColor=white" alt="Angular 21 and 22" />
  <img src="https://img.shields.io/badge/cloudflare-workers-f38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT" /></a>
  <a href="https://github.com/sponsors/erkamyaman"><img src="https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor" /></a>
</p>
<p align="center">
Workers bindings, a working hostname allow-list and in-process API calls for Angular SSR apps on Cloudflare Workers, in <code>ng serve</code> and in production.
</p>

> [!NOTE]
> Work in progress. Nothing is published to npm yet, and the API names below are not final.

## Why

Cloudflare's Angular starter gets an app onto Workers, but four things break once it is real:

| Problem | What happens |
| --- | --- |
| Hostnames | The generated `server.ts` allows only `localhost`, so Angular answers `400 Header "host" ... is not allowed` on the Worker's own `*.workers.dev` address and on custom domains. |
| Bindings | `env`, `ctx` and `request.cf` never reach Angular code, and `ng serve` has no bindings at all, so anything touching D1 or KV needs `ng build` plus `wrangler dev`. |
| Own-API calls | During server rendering, `HttpClient.get('/api/...')` leaves the Worker and fetches its own hostname instead of being answered in place. |
| Log noise | Angular logs a warning for every `forwarded` and `x-forwarded-*` header it drops, on every request. |

## What v0.1 will give you

- **`ng add ngx-cloudflare`**: full setup on a plain `ng new --ssr` app, a patch on Cloudflare-generated projects, and it never overwrites a customised `server.ts`.
- **Bindings everywhere**: typed access to `env`, the execution context and `cf` from components, services and resolvers, in `ng serve` (through wrangler's platform proxy, sharing local state with `wrangler dev`) and on Workers.
- **A sensible allow-list**: `localhost`, `127.0.0.1`, `*.workers.dev` and the hostnames in your wrangler routes, with a clear refusal message and `*` only as an explicit opt-in.
- **Own-API calls in-process**: same-origin `HttpClient` requests are answered inside the Worker during rendering, and Angular's transfer cache keeps working, so the browser does not fetch them again.
- **Quiet logs**: proxy headers are removed before Angular sees them.

Angular CLI apps with SSR on Workers only. Cloudflare Pages, Analog and Angular 20 or older are out of scope.

## Development

This repo is an Angular workspace. The root app is the demo Worker (`ngx-cloudflare-demo`); the library will live in `projects/ngx-cloudflare`.

```bash
npm ci
npm start          # ng serve on http://localhost:4200
npm test           # unit tests (Vitest)
npm run preview    # build, then serve the output in the local Workers runtime
npm run deploy     # build, then wrangler deploy
```

Run `npm run cf-typegen` after changing bindings in `wrangler.jsonc` to regenerate the `Env` types.

## Roadmap

After v0.1: Durable Objects (and anything importing `cloudflare:workers`, which breaks `ng build` today), Workers alongside an existing Node server, Node built-ins guidance, fake bindings for tests, bindings during prerendering, and typed helpers for queues and cron.

## Trademarks and licence

MIT licensed, see [LICENSE](LICENSE).

Cloudflare and Cloudflare Workers are trademarks of Cloudflare, Inc. Angular is a trademark of Google LLC. This project is not affiliated with, endorsed by, or sponsored by either.
