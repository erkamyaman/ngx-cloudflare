import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

const angularApp = new AngularAppEngine({
	allowedHosts: ['localhost', '127.0.0.1', '*.workers.dev'],
});

/**
 * This is a request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createRequestHandler(async (req) => {
	const res = await angularApp.handle(req);

	return res ?? new Response('Page not found.', { status: 404 });
});


export default { fetch: reqHandler };
