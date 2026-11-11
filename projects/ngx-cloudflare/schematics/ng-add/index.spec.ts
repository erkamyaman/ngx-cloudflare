import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { parse } from 'jsonc-parser';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const collection = resolve(
  __dirname,
  '../../../../dist-lib/ngx-cloudflare/schematics/collection.json',
);
const runner = new SchematicTestRunner('ngx-cloudflare', collection);

const CLOUDFLARE_TEMPLATE = `import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

const angularApp = new AngularAppEngine({
\t// It is safe to set allow \`localhost\`, so that SSR can run in local development,
\t// as, in production, Cloudflare will ensure that \`localhost\` is not the host.
\tallowedHosts: ['localhost'],
});

/**
 * This is a request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createRequestHandler(async (req) => {
\tconst res = await angularApp.handle(req);

\treturn res ?? new Response('Page not found.', { status: 404 });
});


export default { fetch: reqHandler };
`;

const COMMON_ENGINE_SERVER = `import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bootstrap from './main.server';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const app = express();
const commonEngine = new CommonEngine();

/**
 * Example:
 * app.get('/api/**', (req, res) => {});
 */
app.get(
  '**',
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: 'index.html'
  }),
);

app.get('**', (req, res, next) => {
  const { protocol, originalUrl, baseUrl, headers } = req;

  commonEngine
    .render({
      bootstrap,
      documentFilePath: indexHtml,
      url: \`\${protocol}://\${headers.host}\${originalUrl}\`,
      publicPath: browserDistFolder,
      providers: [{ provide: APP_BASE_HREF, useValue: baseUrl }],
    })
    .then((html) => res.send(html))
    .catch((err) => next(err));
});

if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(\`Node Express server listening on http://localhost:\${port}\`);
  });
}

export default app;
`;

const LEGACY_SERVER_CONFIG = `import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { appConfig } from './app.config';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering()
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
`;

async function legacy19(version: string): Promise<UnitTestTree> {
  const tree = await workspace({ angular: version });
  tree.overwrite('src/server.ts', COMMON_ENGINE_SERVER);
  tree.overwrite('src/app/app.config.server.ts', LEGACY_SERVER_CONFIG);
  tree.delete('src/app/app.routes.server.ts');
  const angular = JSON.parse(tree.readText('angular.json'));
  angular.projects.shop.architect.build.options.prerender = true;
  tree.overwrite('angular.json', JSON.stringify(angular, null, 2));
  return tree;
}

async function workspace(
  options: { ssr?: boolean; name?: string; angular?: string } = {},
): Promise<UnitTestTree> {
  const name = options.name ?? 'shop';
  let tree = await runner.runExternalSchematic('@schematics/angular', 'workspace', {
    name: 'workspace',
    newProjectRoot: 'projects',
    version: options.angular ?? '22.2.0',
  });
  tree = await runner.runExternalSchematic(
    '@schematics/angular',
    'application',
    { name, projectRoot: '', ssr: options.ssr ?? true, standalone: true },
    tree,
  );
  if (options.angular) {
    const pkg = JSON.parse(tree.readText('package.json'));
    for (const key of Object.keys(pkg.dependencies)) {
      if (key.startsWith('@angular/')) pkg.dependencies[key] = `^${options.angular}`;
    }
    tree.overwrite('package.json', JSON.stringify(pkg, null, 2));
  }
  return tree;
}

const json = (tree: UnitTestTree, path: string) => parse(tree.readText(path));
const build = (tree: UnitTestTree, project = 'shop') =>
  json(tree, 'angular.json').projects[project].architect.build.options;
const add = (tree: UnitTestTree, options: Record<string, unknown> = {}) =>
  runner.runSchematic(
    'ng-add',
    { skipInstall: true, compatibilityDate: '2026-11-10', ...options },
    tree,
  );

describe('ng add ngx-cloudflare', () => {
  let tree: UnitTestTree;

  describe('on a plain ng new --ssr app', () => {
    beforeEach(async () => {
      tree = await add(await workspace());
    });

    it('configures the build for Workers', () => {
      const options = build(tree);
      expect(options.outputMode).toBe('server');
      expect(options.ssr.platform).toBe('neutral');
      expect(options.ssr.entry).toBe('src/server.ts');
      expect(options.externalDependencies).toContain('wrangler');
    });

    it('replaces the stock Node server with the Workers handler', () => {
      const server = tree.readText('src/server.ts');
      expect(server).toContain("from 'ngx-cloudflare/server'");
      expect(server).toContain('createCloudflareRequestHandler()');
      expect(server).toContain('export default { fetch: reqHandler }');
      expect(server).not.toContain('express');
    });

    it('removes express and adds wrangler', () => {
      const pkg = json(tree, 'package.json');
      expect(pkg.dependencies.express).toBeUndefined();
      expect(pkg.devDependencies['@types/express']).toBeUndefined();
      expect(pkg.devDependencies.wrangler).toBe('^4.0.0');
    });

    it('creates wrangler.jsonc that matches the build output', () => {
      const config = json(tree, 'wrangler.jsonc');
      expect(config).toMatchObject({
        name: 'shop',
        main: './dist/shop/server/server.mjs',
        compatibility_date: '2026-11-10',
        assets: { binding: 'ASSETS', directory: './dist/shop/browser' },
      });
    });

    it('registers provideCloudflare() in the server config', () => {
      const config = tree.readText('src/app/app.config.server.ts');
      expect(config).toContain("import { provideCloudflare } from 'ngx-cloudflare';");
      expect(config).toMatch(/provideServerRendering\([^)]*\)\)?,\s*provideCloudflare\(\),?\s*\]/);
      expect(config).toMatch(
        /from '\.\/app\.routes\.server';\nimport \{ provideCloudflare \} from 'ngx-cloudflare';\n/,
      );
    });

    it('renders every route per request instead of prerendering it', () => {
      expect(tree.readText('src/app/app.routes.server.ts')).toContain('RenderMode.Server');
      expect(tree.readText('src/app/app.routes.server.ts')).not.toContain('RenderMode.Prerender');
    });

    it('fixes the scripts', () => {
      const scripts = json(tree, 'package.json').scripts;
      expect(Object.keys(scripts).filter((name) => name.startsWith('serve:ssr'))).toEqual([]);
      expect(scripts).toMatchObject({
        preview: 'ng build && wrangler dev',
        deploy: 'ng build && wrangler deploy',
        'cf-typegen': 'wrangler types',
      });
    });

    it('adds the generated types and ignores local state', () => {
      expect(json(tree, 'tsconfig.app.json').include).toContain('worker-configuration.d.ts');
      expect(json(tree, 'tsconfig.spec.json').include).toContain('worker-configuration.d.ts');
      expect(tree.readText('.gitignore')).toMatch(/^\.wrangler$/m);
      expect(tree.readText('.gitignore')).toMatch(/^\.dev\.vars\*$/m);
    });

    it('is idempotent', async () => {
      const files = [
        'src/server.ts',
        'src/app/app.config.server.ts',
        'angular.json',
        'package.json',
        'wrangler.jsonc',
        'tsconfig.app.json',
        '.gitignore',
      ];
      const before = files.map((file) => tree.readText(file));
      const again = await add(tree);
      expect(files.map((file) => again.readText(file))).toEqual(before);
    });
  });

  it("patches Cloudflare's generated project and keeps hosts that were added by hand", async () => {
    tree = await workspace();
    tree.overwrite(
      'src/server.ts',
      CLOUDFLARE_TEMPLATE.replace("['localhost']", "['localhost', 'shop.example.com']"),
    );
    tree.create(
      'wrangler.jsonc',
      `{\n\t// keep me\n\t"name": "shop",\n\t"main": "./dist/server/server.mjs",\n\t"assets": { "binding": "ASSETS", "directory": "./dist/browser" }\n}\n`,
    );
    const options = JSON.parse(tree.readText('angular.json'));
    options.projects.shop.architect.build.options.outputPath = 'dist';
    tree.overwrite('angular.json', JSON.stringify(options, null, 2));

    tree = await add(tree);

    expect(tree.readText('src/server.ts')).toContain('createCloudflareRequestHandler()');
    expect(json(tree, 'wrangler.jsonc').vars.ALLOWED_HOSTS).toBe('shop.example.com');
    expect(tree.readText('wrangler.jsonc')).toContain('// keep me');
    expect(json(tree, 'wrangler.jsonc').main).toBe('./dist/server/server.mjs');
  });

  it('keeps a multi-line providers array tidy and leaves custom server routes alone', async () => {
    tree = await workspace();
    tree.overwrite(
      'src/app/app.config.server.ts',
      tree
        .readText('src/app/app.config.server.ts')
        .replace(
          /providers: \[([^\]]*)\]/,
          (_match, inner: string) => `providers: [\n    ${inner.trim()},\n  ]`,
        ),
    );
    const routes = tree
      .readText('src/app/app.routes.server.ts')
      .replace("path: '**'", "path: 'about'");
    tree.overwrite('src/app/app.routes.server.ts', routes);
    tree = await add(tree);
    expect(tree.readText('src/app/app.config.server.ts')).toMatch(
      /\n    provideServerRendering\(.*\),\n    provideCloudflare\(\),\n  \]/,
    );
    expect(tree.readText('src/app/app.routes.server.ts')).toBe(routes);
  });

  it('replaces the untouched Cloudflare template', async () => {
    tree = await workspace();
    tree.overwrite('src/server.ts', CLOUDFLARE_TEMPLATE);
    tree = await add(tree);
    expect(tree.readText('src/server.ts')).toContain('createCloudflareRequestHandler()');
  });

  it('never overwrites a customised server.ts', async () => {
    tree = await workspace();
    const custom = tree
      .readText('src/server.ts')
      .replace(
        '/**\n * Serve static files',
        "app.get('/api/health', (_req, res) => { res.json({ ok: true }); });\n\n/**\n * Serve static files",
      );
    tree.overwrite('src/server.ts', custom);
    const logs: string[] = [];
    runner.logger.subscribe((entry) => logs.push(entry.message));

    tree = await add(tree);

    expect(tree.readText('src/server.ts')).toBe(custom);
    expect(json(tree, 'package.json').dependencies.express).toBeDefined();
    expect(logs.join('\n')).toContain('has custom code');
  });

  it('repairs a wrangler config that set the app up as a static site', async () => {
    tree = await workspace();
    tree.create(
      'wrangler.jsonc',
      `{\n  // from wrangler's autoconfig\n  "name": "shop-web",\n  "compatibility_date": "2026-11-10",\n  "assets": { "directory": "dist/" }\n}\n`,
    );
    tree = await add(tree);
    const config = json(tree, 'wrangler.jsonc');
    expect(config.name).toBe('shop-web');
    expect(config.main).toBe('./dist/shop/server/server.mjs');
    expect(config.assets).toEqual({ directory: './dist/shop/browser', binding: 'ASSETS' });
    expect(tree.readText('wrangler.jsonc')).toContain("// from wrangler's autoconfig");
  });

  it('adds hostnames from wrangler routes to ALLOWED_HOSTS, again on a later run', async () => {
    tree = await workspace();
    tree.create(
      'wrangler.jsonc',
      JSON.stringify({
        name: 'shop',
        main: './dist/shop/server/server.mjs',
        assets: { binding: 'ASSETS', directory: './dist/shop/browser' },
        routes: [
          { pattern: 'shop.example.com', custom_domain: true },
          'example.com/*',
          { pattern: '*.example.org/*', zone_name: 'example.org' },
        ],
        env: { staging: { route: 'staging.example.com/*' } },
      }),
    );
    tree = await add(tree);
    expect(json(tree, 'wrangler.jsonc').vars.ALLOWED_HOSTS).toBe(
      'shop.example.com,example.com,*.example.org,staging.example.com',
    );
    expect(tree.readText('src/server.ts')).toContain('createCloudflareRequestHandler()');

    const config = json(tree, 'wrangler.jsonc');
    config.routes.push('new.example.com/*');
    tree.overwrite('wrangler.jsonc', JSON.stringify(config));
    tree = await add(tree);
    expect(json(tree, 'wrangler.jsonc').vars.ALLOWED_HOSTS).toBe(
      'shop.example.com,example.com,*.example.org,staging.example.com,new.example.com',
    );
  });

  it('uses the Angular project name, not the package name, for the Worker', async () => {
    tree = await workspace({ name: 'MyShop' });
    const pkg = JSON.parse(tree.readText('package.json'));
    pkg.name = 'shop-web';
    tree.overwrite('package.json', JSON.stringify(pkg));
    tree = await add(tree);
    expect(json(tree, 'wrangler.jsonc')).toMatchObject({
      name: 'my-shop',
      main: './dist/MyShop/server/server.mjs',
    });
    expect(build(tree, 'MyShop').ssr.platform).toBe('neutral');
  });

  it.each(['19.2.0', '20.3.0', '21.2.0'])(
    'uses ssr.experimentalPlatform on Angular %s',
    async (version) => {
      tree = await add(await workspace({ angular: version }));
      const options = build(tree);
      expect(options.ssr.experimentalPlatform).toBe('neutral');
      expect(options.ssr.platform).toBeUndefined();
    },
  );

  it('converts an Angular 19 CommonEngine app without server routes', async () => {
    tree = await add(await legacy19('19.2.0'));

    expect(tree.readText('src/server.ts')).toContain('createCloudflareRequestHandler()');
    expect(json(tree, 'package.json').dependencies.express).toBeUndefined();
    expect(tree.readText('src/app/app.routes.server.ts')).toContain('RenderMode.Server');
    const config = tree.readText('src/app/app.config.server.ts');
    expect(config).toContain("import { provideServerRouting } from '@angular/ssr';");
    expect(config).toContain("import { serverRoutes } from './app.routes.server';");
    expect(config).toMatch(
      /provideServerRendering\(\),\n    provideServerRouting\(serverRoutes\),\n    provideCloudflare\(\),\n  \]/,
    );
    const options = build(tree);
    expect(options.prerender).toBeUndefined();
    expect(options.ssr.experimentalPlatform).toBe('neutral');
  });

  it('uses provideServerRoutesConfig before Angular 19.2', async () => {
    tree = await add(await legacy19('19.1.0'));
    expect(tree.readText('src/app/app.config.server.ts')).toContain(
      'provideServerRoutesConfig(serverRoutes)',
    );
  });

  it('refuses Angular 18 with the reason', async () => {
    await expect(add(await workspace({ angular: '18.2.0' }))).rejects.toThrow(
      /Angular 19 and newer[\s\S]*AngularAppEngine and REQUEST_CONTEXT arrived in 19/,
    );
  });

  it('asks for SSR first when the app has none', async () => {
    await expect(add(await workspace({ ssr: false }))).rejects.toThrow(/ng add @angular\/ssr/);
  });
});
