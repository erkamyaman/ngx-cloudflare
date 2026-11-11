import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';

export const WRANGLER_CONFIG_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'] as const;

const DEFAULT_HOSTS = new Set(['localhost', '127.0.0.1', '*.workers.dev']);

export interface WorkerOutput {
  main: string;
  assets: string;
}

type Route = string | { pattern?: string; custom_domain?: boolean; zone_name?: string };

interface WranglerConfig {
  name?: string;
  main?: string;
  assets?: { directory?: string; binding?: string };
  route?: Route;
  routes?: Route[];
  env?: Record<string, { route?: Route; routes?: Route[] }>;
}

export function parseWranglerConfig(text: string): WranglerConfig {
  const errors: ParseError[] = [];
  const config = parse(text, errors, { allowTrailingComma: true }) as WranglerConfig | undefined;
  if (errors.length || typeof config !== 'object' || config === null) {
    throw new Error(
      'ngx-cloudflare: could not parse the wrangler config. Fix its syntax and run ng add again.',
    );
  }
  return config;
}

export function workerName(projectName: string): string {
  const name = projectName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
  return name || 'angular-app';
}

function routeHost(route: Route): string | null {
  const pattern = typeof route === 'string' ? route : route.pattern;
  if (!pattern) {
    return null;
  }
  const host = pattern
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .toLowerCase();
  return host || null;
}

export function hostsFromConfig(config: WranglerConfig): string[] {
  const routes: Route[] = [];
  const collect = (scope: { route?: Route; routes?: Route[] }) => {
    if (scope.route) {
      routes.push(scope.route);
    }
    routes.push(...(scope.routes ?? []));
  };
  collect(config);
  for (const env of Object.values(config.env ?? {})) {
    collect(env);
  }
  const hosts: string[] = [];
  for (const route of routes) {
    const host = routeHost(route);
    if (host && !DEFAULT_HOSTS.has(host) && !hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

export function createWranglerConfig(
  name: string,
  output: WorkerOutput,
  compatibilityDate: string,
): string {
  return `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "${name}",
  "main": "${output.main}",
  "compatibility_date": "${compatibilityDate}",
  "assets": {
    "binding": "ASSETS",
    "directory": "${output.assets}"
  },
  "observability": {
    "enabled": true
  }
}
`;
}

export interface RepairResult {
  text: string;
  changes: string[];
}

export function repairWranglerConfig(text: string, output: WorkerOutput): RepairResult {
  const config = parseWranglerConfig(text);
  const changes: string[] = [];
  const formatting = { formattingOptions: { insertSpaces: !text.includes('\n\t'), tabSize: 2 } };
  let result = text;
  const set = (path: (string | number)[], value: unknown) => {
    result = applyEdits(result, modify(result, path, value, formatting));
  };

  if (config.main !== output.main) {
    set(['main'], output.main);
    changes.push(
      config.main
        ? `main: ${config.main} -> ${output.main}`
        : `main: ${output.main} (was missing, so the app was deployed without server rendering)`,
    );
  }
  if (config.assets?.directory !== output.assets) {
    set(['assets', 'directory'], output.assets);
    changes.push(`assets.directory: ${config.assets?.directory ?? '(none)'} -> ${output.assets}`);
  }
  if (!config.assets?.binding) {
    set(['assets', 'binding'], 'ASSETS');
    changes.push('assets.binding: ASSETS');
  }
  return { text: result, changes };
}
