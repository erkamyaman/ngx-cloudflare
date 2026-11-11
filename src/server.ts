import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';
import { api } from './api';

export const reqHandler = createCloudflareRequestHandler<Env>({ api });

export default { fetch: reqHandler } satisfies ExportedHandler<Env>;
