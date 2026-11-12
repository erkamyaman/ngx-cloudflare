# Changelog

All notable changes to the `ngx-cloudflare` package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until 1.0.0, a minor version may rename or remove public functions.

## [Unreleased]

### Added

- `cachePages` option: stores rendered pages in the Workers Cache API when their `Cache-Control` has a shared max-age, skipping requests with cookies or `Authorization`.
- `isCacheablePageRequest(request)` and `isCacheablePageResponse(response)` helpers.

### Changed

- Internal exports now start with `ɵ` and may change in any release: `ɵCloudflareFetchBackend`, `ɵisCloudflareContext`, `ɵtoApiHandler`, `ɵcallInProcess`, `ɵCLOUDFLARE_CONTEXT_MARKER`.
- `createTestExecutionContext` is renamed to `createCloudflareTestExecutionContext`, to match `createCloudflareTestContext`.
- Durable Objects recipe: a second layout keeps the class in its own Worker, bound by `script_name`, so the binding also works in `ng serve`.

### Removed

- Exports nothing used: `hostRefusal`, `isProxyHeader`, `DEFAULT_ALLOWED_HOSTS`, `DEFAULT_API_PREFIX`, `ALLOWED_HOSTS_VAR`.

## [0.2.2] - 2026-11-12

### Added

- `CHANGELOG.md`, also shipped in the npm package.
- The ngx-cloudflare logo at the top of the README.

## [0.2.1] - 2026-11-11

### Changed

- README: the note now says this is an early 0.x release instead of "not on npm yet".

## [0.2.0] - 2026-11-11

First public release.

### Added

- `ngx-cloudflare/server`:
  - `createCloudflareRequestHandler(options?)`, the Worker `fetch` handler for Angular SSR. It passes `env`, `ctx` and `request.cf` to Angular, and fills them in under `ng serve` through wrangler's platform proxy.
  - A hostname allow-list that works on Workers: `localhost`, `127.0.0.1`, `*.workers.dev`, `allowedHosts` from code and the `ALLOWED_HOSTS` var. Other hosts get a 400 that says where to add them.
  - An `api` option for requests under `/api/`, and `dispatch`, which answers them in-process (falling back to the `ASSETS` binding) instead of a network self-fetch that Cloudflare rejects with error 1042.
  - Removal of `forwarded` and `x-forwarded-*` headers before Angular sees them.
  - `createCloudflareFetch` and helpers: `resolveAllowedHosts`, `isHostAllowed`, `stripProxyHeaders`, `isCloudflareContext`, `hostsFromEnv`, `toApiHandler`, `callInProcess`, `isInProcessRequest`.
- `ngx-cloudflare`:
  - `injectCloudflare`, `injectEnv`, `injectExecutionContext` and `injectRequestCf`, each with `{ required: true }`.
  - `provideCloudflare()`, which answers same-origin `HttpClient` calls in-process during rendering while keeping Angular's transfer cache working.
- `ngx-cloudflare/testing`: `provideCloudflareTesting`, `createCloudflareTestContext` and `createTestExecutionContext` for TestBed.
- `ng add ngx-cloudflare` for apps made by `ng new --ssr`, `npm create cloudflare` and `wrangler setup`:
  - sets the build to `outputMode: server` and the neutral SSR platform, and keeps `wrangler` out of the bundle
  - replaces a stock `src/server.ts`
  - copies wrangler route hosts into `ALLOWED_HOSTS`
  - creates or repairs `wrangler.jsonc`
  - switches the stock prerender route to server rendering
  - converts Angular 19 apps without server routing
  - adds `preview`, `deploy` and `cf-typegen` scripts
- Support for Angular 19 to 22.

[Unreleased]: https://github.com/erkamyaman/ngx-cloudflare/compare/1feab4d...HEAD
[0.2.2]: https://www.npmjs.com/package/ngx-cloudflare/v/0.2.2
[0.2.1]: https://www.npmjs.com/package/ngx-cloudflare/v/0.2.1
[0.2.0]: https://www.npmjs.com/package/ngx-cloudflare/v/0.2.0
