# Troubleshooting

## `Host "..." is not allowed by ngx-cloudflare`

The request's hostname is not on the allow-list. Add it to `ALLOWED_HOSTS` in the `vars` of `wrangler.jsonc` and redeploy, or to `allowedHosts` in `src/server.ts`. Defaults are `localhost`, `127.0.0.1` and `*.workers.dev`.

If you see Angular's own message instead (`Header "host" with value ... is not allowed`), the server entry is not using `createCloudflareRequestHandler()`. Run `ng add ngx-cloudflare` again or update `src/server.ts` by hand.

## `injectEnv()` returns `null`

- In the browser this is expected.
- The route is prerendered. Check `src/app/app.routes.server.ts` for `RenderMode.Prerender` and switch the route to `RenderMode.Server`.
- `src/server.ts` does not use `createCloudflareRequestHandler()`.
- Under `ng serve`, wrangler is missing or `wrangler.jsonc` has an error. The dev server logs `could not start wrangler's platform proxy` with the cause.

## `ng serve` fails to start after adding the package

Check that `angular.json` lists `wrangler` in `externalDependencies` for the build target. Without it the dev build tries to bundle wrangler and cannot resolve Node built-ins.

## `ng build` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`

Something imported by `src/server.ts` imports `cloudflare:workers`. Angular runs the server bundle in Node during the build. Move that code to a separate Worker entry, as in the [Durable Objects recipe](recipes.md#durable-objects).

## The page calls its API twice

Once on the server and once in the browser means the transfer cache did not record the response. Check that:

- `provideClientHydration()` is in the app config,
- `provideCloudflare()` is in the server config, after `provideServerRendering()`,
- the request is a `GET` or `HEAD` without an `Authorization` header (Angular skips the others by default).

## The deployed site serves only static files

`wrangler.jsonc` has no `main`, so the Worker never runs and pages are not rendered on the server. `wrangler setup` does this when the Worker name differs from the Angular project name. Run `ng add ngx-cloudflare` to repair it.

## The first request in `ng serve` is slow

The first request starts the local Workers runtime, which takes a few seconds. Later requests and rebuilds reuse it.
