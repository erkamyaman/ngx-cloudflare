export type ServerEntryKind =
  'missing' | 'ours' | 'angular-node' | 'cloudflare-template' | 'custom';

export interface ServerEntryInfo {
  kind: ServerEntryKind;
  keptHosts: string[];
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function compact(source: string): string {
  return stripComments(source).replace(/\s+/g, '').replace(/"/g, "'");
}

const CLOUDFLARE_TEMPLATE =
  /^import\{AngularAppEngine,createRequestHandler\}from'@angular\/ssr';constangularApp=newAngularAppEngine\(\{allowedHosts:\[([^\]]*)\],?\}\);exportconstreqHandler=createRequestHandler\(async\(req\)=>\{constres=awaitangularApp\.handle\(req\);returnres\?\?newResponse\('Pagenotfound\.',\{status:404\}\);?\}\);exportdefault\{fetch:reqHandler,?\};?$/;

const NODE_IMPORTS = new Set([
  '@angular/common',
  './main.server',
  '@angular/ssr/node',
  'express',
  'node:path',
  'path',
  'node:url',
  'url',
]);

export function classifyServerEntry(source: string | null): ServerEntryInfo {
  if (source === null) {
    return { kind: 'missing', keptHosts: [] };
  }
  if (source.includes('ngx-cloudflare/server')) {
    return { kind: 'ours', keptHosts: [] };
  }
  const code = compact(source);
  const template = CLOUDFLARE_TEMPLATE.exec(code);
  if (template) {
    const keptHosts = template[1]
      .split(',')
      .map((host) => host.replace(/['`]/g, ''))
      .filter(Boolean);
    return { kind: 'cloudflare-template', keptHosts };
  }
  const imports = [...stripComments(source).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const routes =
    code.match(/\bapp\.(get|post|put|delete|patch|all|use|route|options|head)\(/g) ?? [];
  if (
    code.includes('newAngularNodeAppEngine()') &&
    code.includes('exportconstreqHandler=createNodeRequestHandler(app)') &&
    imports.every((name) => NODE_IMPORTS.has(name)) &&
    routes.length === 2
  ) {
    return { kind: 'angular-node', keptHosts: [] };
  }
  if (
    code.includes('newCommonEngine()') &&
    code.includes('exportdefaultapp') &&
    imports.every((name) => NODE_IMPORTS.has(name)) &&
    routes.length === 2
  ) {
    return { kind: 'angular-node', keptHosts: [] };
  }
  return { kind: 'custom', keptHosts: [] };
}

export function renderServerEntry(hosts: readonly string[]): string {
  const hostOption = hosts.length
    ? `\n  allowedHosts: [${hosts.map((host) => `'${host}'`).join(', ')}],\n`
    : '';
  const options = hostOption ? `{${hostOption}}` : '';
  return `import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';

export const reqHandler = createCloudflareRequestHandler(${options});

export default { fetch: reqHandler };
`;
}

export const SERVER_ENTRY_INSTRUCTIONS = `import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';

export const reqHandler = createCloudflareRequestHandler({
  allowedHosts: [/* your custom domains */],
  api: (request, env, ctx) => /* your API handler, or a Hono app */ null,
});

export default { fetch: reqHandler };`;
