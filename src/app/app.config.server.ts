import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideUniversal } from '@ng-web-apis/universal';
import { provideCloudflare } from 'ngx-cloudflare';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    provideCloudflare(),
    provideUniversal(),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
