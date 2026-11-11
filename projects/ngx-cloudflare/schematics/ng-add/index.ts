import {
  chain,
  Rule,
  SchematicContext,
  SchematicsException,
  Tree,
} from '@angular-devkit/schematics';
import {
  addDependency,
  DependencyType,
  ExistingBehavior,
  InstallBehavior,
  readWorkspace,
  updateWorkspace,
} from '@schematics/angular/utility';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { posix } from 'node:path';
import { addProvider } from './add-provider';
import { classifyServerEntry, renderServerEntry, SERVER_ENTRY_INSTRUCTIONS } from './server-entry';
import {
  addAllowedHostsVar,
  createWranglerConfig,
  hostsFromConfig,
  parseWranglerConfig,
  repairWranglerConfig,
  workerName,
  WorkerOutput,
} from './wrangler-config';

export interface NgAddOptions {
  project?: string;
  skipInstall?: boolean;
  compatibilityDate?: string;
}

type Json = Record<string, unknown>;

interface SetupPlan {
  projectName: string;
  root: string;
  sourceRoot: string;
  angularMajor: number;
  serverEntry: string;
  tsConfigs: string[];
  output: WorkerOutput;
  outputBase: string;
}

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

function readText(tree: Tree, path: string): string | null {
  return tree.exists(path) ? tree.readText(path) : null;
}

function editJson(
  tree: Tree,
  path: string,
  edit: (original: string, set: (p: (string | number)[], v: unknown) => void) => void,
): void {
  const original = tree.readText(path);
  let text = original;
  edit(original, (jsonPath, value) => {
    text = applyEdits(text, modify(text, jsonPath, value, FORMAT));
  });
  if (text !== original) {
    tree.overwrite(path, text);
  }
}

function packageVersion(tree: Tree, name: string): { major: number; minor: number } {
  const installed = readText(tree, `node_modules/${name}/package.json`);
  const declared = (parse(readText(tree, 'package.json') ?? '{}') as { dependencies?: Json })
    .dependencies?.[name];
  const version = installed
    ? (JSON.parse(installed) as { version: string }).version
    : (declared as string | undefined);
  const match = /(\d+)(?:\.(\d+))?/.exec(version ?? '');
  return { major: Number(match?.[1] ?? 0), minor: Number(match?.[2] ?? 0) };
}

function angularMajor(tree: Tree): number {
  const { major } = packageVersion(tree, '@angular/core');
  if (!major) {
    throw new SchematicsException('ngx-cloudflare: could not find @angular/core in package.json.');
  }
  if (major < 19) {
    throw new SchematicsException(
      `ngx-cloudflare supports Angular 19 and newer. Angular ${major} has no Workers-compatible SSR engine (AngularAppEngine and REQUEST_CONTEXT arrived in 19). Update Angular first: https://angular.dev/update-guide`,
    );
  }
  return major;
}

function resolveOutput(
  projectName: string,
  outputPath: unknown,
): { base: string; output: WorkerOutput } {
  let base = `dist/${projectName}`;
  let browser = 'browser';
  let server = 'server';
  if (typeof outputPath === 'string') {
    base = outputPath;
  } else if (outputPath && typeof outputPath === 'object') {
    const value = outputPath as { base?: string; browser?: string; server?: string };
    base = value.base ?? base;
    browser = value.browser ?? browser;
    server = value.server ?? server;
  }
  base = posix.normalize(base.replace(/\\/g, '/')).replace(/^\.\//, '').replace(/\/$/, '');
  const join = (...parts: string[]) => './' + posix.join(...parts.filter(Boolean));
  return { base, output: { main: join(base, server, 'server.mjs'), assets: join(base, browser) } };
}

async function createSetupPlan(tree: Tree, options: NgAddOptions): Promise<SetupPlan> {
  const workspace = await readWorkspace(tree);
  const applications = [...workspace.projects].filter(
    ([, project]) => project.extensions['projectType'] === 'application',
  );
  const name =
    options.project ??
    applications.find(([, project]) => project.targets.get('build')?.options?.['ssr'])?.[0] ??
    applications[0]?.[0];
  const project = name ? workspace.projects.get(name) : undefined;
  if (!name || !project) {
    throw new SchematicsException(
      `ngx-cloudflare: project "${options.project ?? ''}" was not found in angular.json.`,
    );
  }
  const build = project.targets.get('build');
  const buildOptions = (build?.options ?? {}) as Json;
  if (!buildOptions['ssr'] || !buildOptions['server']) {
    throw new SchematicsException(
      `ngx-cloudflare needs server-side rendering. Run "ng add @angular/ssr --project ${name}" first, then run "ng add ngx-cloudflare" again.`,
    );
  }
  const root = project.root;
  const sourceRoot = project.sourceRoot ?? posix.join(root, 'src');
  const ssr = buildOptions['ssr'];
  const serverEntry =
    typeof ssr === 'object' && ssr !== null && typeof (ssr as Json)['entry'] === 'string'
      ? ((ssr as Json)['entry'] as string)
      : posix.join(sourceRoot, 'server.ts');
  const { base, output } = resolveOutput(name, buildOptions['outputPath']);
  return {
    projectName: name,
    root,
    sourceRoot,
    angularMajor: angularMajor(tree),
    serverEntry: serverEntry.replace(/^\.\//, ''),
    tsConfigs: [
      buildOptions['tsConfig'],
      project.targets.get('test')?.options?.['tsConfig'] ?? posix.join(root, 'tsconfig.spec.json'),
    ].filter(
      (path, index, all): path is string => typeof path === 'string' && all.indexOf(path) === index,
    ),
    output,
    outputBase: base,
  };
}

function updateAngularJson(setup: SetupPlan): Rule {
  return updateWorkspace((workspace) => {
    const build = workspace.projects.get(setup.projectName)!.targets.get('build')!;
    const options = (build.options ??= {}) as Json;
    const ssr =
      typeof options['ssr'] === 'object' && options['ssr'] !== null
        ? { ...(options['ssr'] as Json) }
        : {};
    ssr['entry'] ??= setup.serverEntry;
    const platformKey = setup.angularMajor >= 22 ? 'platform' : 'experimentalPlatform';
    delete ssr[setup.angularMajor >= 22 ? 'experimentalPlatform' : 'platform'];
    ssr[platformKey] = 'neutral';
    options['ssr'] = ssr;
    options['outputMode'] = 'server';
    delete options['prerender'];
    const external = Array.isArray(options['externalDependencies'])
      ? (options['externalDependencies'] as string[])
      : [];
    if (!external.includes('wrangler')) {
      options['externalDependencies'] = [...external, 'wrangler'];
    }
  });
}

function wranglerConfigPath(tree: Tree): string | null {
  return (
    ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].find((file) => tree.exists(file)) ?? null
  );
}

function updateWranglerConfig(setup: SetupPlan, options: NgAddOptions): Rule {
  return (tree, context) => {
    const path = wranglerConfigPath(tree);
    if (!path) {
      const date = options.compatibilityDate ?? new Date().toISOString().slice(0, 10);
      tree.create(
        'wrangler.jsonc',
        createWranglerConfig(workerName(setup.projectName), setup.output, date),
      );
      context.logger.info(`Created wrangler.jsonc for Worker "${workerName(setup.projectName)}".`);
      return;
    }
    if (path.endsWith('.toml')) {
      context.logger.warn(
        `wrangler.toml is not edited automatically. Set main = "${setup.output.main}" and [assets] directory = "${setup.output.assets}", binding = "ASSETS".`,
      );
      return;
    }
    const { text, changes } = repairWranglerConfig(tree.readText(path), setup.output);
    if (changes.length) {
      tree.overwrite(path, text);
      context.logger.info(`Updated ${path}:\n  - ${changes.join('\n  - ')}`);
    }
  };
}

function routeHosts(tree: Tree): string[] {
  const path = wranglerConfigPath(tree);
  if (!path || path.endsWith('.toml')) {
    return [];
  }
  return hostsFromConfig(parseWranglerConfig(tree.readText(path)));
}

function updateServerEntry(setup: SetupPlan): Rule {
  return (tree, context) => {
    const current = readText(tree, setup.serverEntry);
    const info = classifyServerEntry(current);
    const customHosts = [...new Set([...info.keptHosts, ...routeHosts(tree)])].filter(
      (host) => !['localhost', '127.0.0.1', '*.workers.dev'].includes(host),
    );
    const configPath = wranglerConfigPath(tree);
    const hostsInConfig = configPath !== null && !configPath.endsWith('.toml');
    if (hostsInConfig && customHosts.length) {
      const { text, added } = addAllowedHostsVar(tree.readText(configPath), customHosts);
      if (added.length) {
        tree.overwrite(configPath, text);
        context.logger.info(`Added ${added.join(', ')} to ALLOWED_HOSTS in ${configPath}.`);
      }
    }
    const hosts = hostsInConfig ? [] : customHosts;
    switch (info.kind) {
      case 'ours':
        context.logger.info(`${setup.serverEntry} already uses ngx-cloudflare. Left unchanged.`);
        return;
      case 'custom':
        context.logger.warn(
          `${setup.serverEntry} has custom code, so ngx-cloudflare did not change it. Move your routes into the api option and use:\n\n${SERVER_ENTRY_INSTRUCTIONS}\n`,
        );
        return;
      default:
        if (current === null) {
          tree.create(setup.serverEntry, renderServerEntry(hosts));
        } else {
          tree.overwrite(setup.serverEntry, renderServerEntry(hosts));
        }
        context.logger.info(
          `${current === null ? 'Created' : 'Replaced'} ${setup.serverEntry} (${info.kind === 'angular-node' ? 'stock Node server' : info.kind === 'cloudflare-template' ? "Cloudflare's template" : 'new'}).`,
        );
        if (info.kind === 'angular-node') {
          editJson(tree, 'package.json', (text, set) => {
            const pkg = parse(text) as { dependencies?: Json; devDependencies?: Json };
            if (pkg.dependencies?.['express']) set(['dependencies', 'express'], undefined);
            if (pkg.devDependencies?.['@types/express'])
              set(['devDependencies', '@types/express'], undefined);
          });
        }
    }
  };
}

function findServerConfig(tree: Tree, setup: SetupPlan): string | null {
  const conventional = posix.join(setup.sourceRoot, 'app/app.config.server.ts');
  if (tree.exists(conventional)) {
    return conventional;
  }
  let found: string | null = null;
  tree.getDir(setup.sourceRoot).visit((path) => {
    if (
      !found &&
      path.endsWith('.ts') &&
      !path.endsWith('.spec.ts') &&
      tree.readText(path).includes('provideServerRendering(')
    ) {
      found = path.replace(/^\//, '');
    }
  });
  return found;
}

const MANUAL_PROVIDER =
  'Add provideCloudflare() from ngx-cloudflare to the providers of your server application config.';

function updateServerConfig(setup: SetupPlan): Rule {
  return (tree, context) => {
    const path = findServerConfig(tree, setup);
    if (!path) {
      context.logger.warn(`Could not find the server application config. ${MANUAL_PROVIDER}`);
      return;
    }
    const text = tree.readText(path);
    if (text.includes('provideCloudflare(')) {
      return;
    }
    const updated = addProvider(text, 'provideCloudflare()', [
      "import { provideCloudflare } from 'ngx-cloudflare';",
    ]);
    if (updated === null) {
      context.logger.warn(`Could not edit ${path}. ${MANUAL_PROVIDER}`);
      return;
    }
    tree.overwrite(path, updated);
    context.logger.info(`Added provideCloudflare() to ${path}.`);
  };
}

const SERVER_ROUTING_CALLS = ['withRoutes(', 'provideServerRouting(', 'provideServerRoutesConfig('];

function addServerRouting(setup: SetupPlan): Rule {
  return (tree, context) => {
    const path = findServerConfig(tree, setup);
    if (!path) {
      return;
    }
    const text = tree.readText(path);
    if (SERVER_ROUTING_CALLS.some((call) => text.includes(call))) {
      return;
    }
    const routesPath = posix.join(posix.dirname(path), 'app.routes.server.ts');
    const routesImport = `./${posix.basename(routesPath, '.ts')}`;
    const manual = `${path} has no server routes, which AngularAppEngine needs. Add a ${routesPath} with RenderMode.Server routes and register them, see https://angular.dev/guide/ssr#configure-server-side-rendering`;
    if (setup.angularMajor !== 19) {
      context.logger.warn(manual);
      return;
    }
    const ssr = packageVersion(tree, '@angular/ssr');
    const provider =
      ssr.major > 19 || ssr.minor >= 2 ? 'provideServerRouting' : 'provideServerRoutesConfig';
    const updated = addProvider(text, `${provider}(serverRoutes)`, [
      `import { ${provider} } from '@angular/ssr';`,
      `import { serverRoutes } from '${routesImport}';`,
    ]);
    if (updated === null) {
      context.logger.warn(manual);
      return;
    }
    if (!tree.exists(routesPath)) {
      tree.create(
        routesPath,
        `import { RenderMode, ServerRoute } from '@angular/ssr';\n\nexport const serverRoutes: ServerRoute[] = [\n  {\n    path: '**',\n    renderMode: RenderMode.Server,\n  },\n];\n`,
      );
    }
    tree.overwrite(path, updated);
    context.logger.info(
      `Added server routes (${provider}) to ${path}; every route is rendered per request.`,
    );
  };
}

const STOCK_SERVER_ROUTES =
  /^import\{RenderMode,ServerRoute\}from'@angular\/ssr';exportconstserverRoutes:ServerRoute\[\]=\[\{path:'\*\*',renderMode:RenderMode\.Prerender,?\},?\];?$/;

function updateServerRoutes(setup: SetupPlan): Rule {
  return (tree, context) => {
    const path = posix.join(setup.sourceRoot, 'app/app.routes.server.ts');
    const text = readText(tree, path);
    if (text === null || !STOCK_SERVER_ROUTES.test(text.replace(/\s+/g, '').replace(/"/g, "'"))) {
      return;
    }
    tree.overwrite(path, text.replace('RenderMode.Prerender', 'RenderMode.Server'));
    context.logger.info(
      `Switched ${path} from RenderMode.Prerender to RenderMode.Server, so pages are rendered per request with bindings.`,
    );
  };
}

function updatePackageScripts(setup: SetupPlan): Rule {
  return (tree) => {
    editJson(tree, 'package.json', (text, set) => {
      const pkg = parse(text) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const [name, command] of Object.entries(scripts)) {
        if (name.startsWith('serve:ssr') && /server\.mjs/.test(command)) {
          set(['scripts', name], undefined);
        }
      }
      const wanted: Record<string, string> = {
        preview: 'ng build && wrangler dev',
        deploy: 'ng build && wrangler deploy',
        'cf-typegen': 'wrangler types',
      };
      for (const [name, command] of Object.entries(wanted)) {
        if (!scripts[name]) {
          set(['scripts', name], command);
        }
      }
    });
  };
}

function updateTsConfigs(setup: SetupPlan): Rule {
  return (tree) => {
    for (const tsConfig of setup.tsConfigs) {
      if (tree.exists(tsConfig)) {
        addTypesFile(tree, tsConfig);
      }
    }
  };
}

function addTypesFile(tree: Tree, tsConfig: string): void {
  {
    const typesFile =
      posix.relative(posix.dirname(tsConfig), 'worker-configuration.d.ts') ||
      'worker-configuration.d.ts';
    editJson(tree, tsConfig, (text, set) => {
      const config = parse(text) as { include?: string[]; files?: string[] };
      if (config.include?.includes(typesFile) || config.files?.includes(typesFile)) {
        return;
      }
      if (config.include) {
        set(['include', config.include.length], typesFile);
      } else {
        set(['files', config.files?.length ?? 0], typesFile);
      }
    });
  }
}

function updateGitignore(): Rule {
  return (tree) => {
    const current = readText(tree, '.gitignore');
    if (current === null) {
      return;
    }
    const lines = current.split(/\r?\n/);
    const missing = ['.wrangler', '.dev.vars*'].filter(
      (entry) => !lines.some((line) => line.trim() === entry || line.trim() === `/${entry}`),
    );
    if (missing.length) {
      tree.overwrite(
        '.gitignore',
        `${current.replace(/\s*$/, '')}\n\n# Cloudflare Workers\n${missing.join('\n')}\n`,
      );
    }
  };
}

function nextSteps(setup: SetupPlan): Rule {
  return (_tree, context) => {
    context.logger.info(
      [
        '',
        'ngx-cloudflare is set up. Next:',
        '  npm run cf-typegen   generate the Env type from wrangler.jsonc',
        "  ng serve             bindings come from wrangler's local platform proxy",
        '  npm run preview      build, then run it in the local Workers runtime',
        '  npm run deploy       build, then wrangler deploy',
        '',
        `Custom domains go in ALLOWED_HOSTS in the vars of wrangler.jsonc. Routes rendered at build time (RenderMode.Prerender) have no bindings.`,
      ].join('\n'),
    );
  };
}

export function ngAdd(options: NgAddOptions = {}): Rule {
  return async (tree: Tree, _context: SchematicContext) => {
    const setup = await createSetupPlan(tree, options);
    return chain([
      updateAngularJson(setup),
      updateWranglerConfig(setup, options),
      updateServerEntry(setup),
      addServerRouting(setup),
      updateServerConfig(setup),
      updateServerRoutes(setup),
      updatePackageScripts(setup),
      updateTsConfigs(setup),
      updateGitignore(),
      addDependency('wrangler', '^4.0.0', {
        type: DependencyType.Dev,
        existing: ExistingBehavior.Skip,
        install: options.skipInstall ? InstallBehavior.None : InstallBehavior.Auto,
      }),
      nextSteps(setup),
    ]);
  };
}
