export const samples = [
  {
    file: 'src/server.ts',
    note: 'The whole Worker entry. ng add writes it.',
    code: `import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';
import { api } from './api';

export const reqHandler = createCloudflareRequestHandler<Env>({ api });

export default { fetch: reqHandler } satisfies ExportedHandler<Env>;`,
  },
  {
    file: 'src/api.ts',
    note: 'Requests under /api/ arrive here with env. Return null to let Angular render.',
    code: `export async function api(request: Request, env: Env) {
  if (new URL(request.url).pathname === '/api/entries') {
    const { results } = await env.DB
      .prepare('SELECT id, name, message, created_at FROM entries ORDER BY id DESC LIMIT 50')
      .all<Entry>();
    return Response.json(results, {
      headers: { 'x-served-via': isInProcessRequest(request) ? 'in-process' : 'network' },
    });
  }
  return null;
}`,
  },
  {
    file: 'src/app/guestbook/guestbook.ts',
    note: 'Bindings in a component. During SSR the HttpClient call never leaves the Worker.',
    code: `const cf = injectCloudflare<Env>(); // null in the browser
if (cf) {
  const count = Number(await cf.env.VISITS.get('count')) + 1;
  cf.ctx.waitUntil(cf.env.VISITS.put('count', String(count)));
}

entries = httpResource<Entry[]>(() => '/api/entries');`,
  },
  {
    file: 'src/app/app.config.server.ts',
    note: 'Routes same-origin HttpClient calls through the Worker during rendering.',
    code: `providers: [provideServerRendering(withRoutes(serverRoutes)), provideCloudflare()]`,
  },
];
