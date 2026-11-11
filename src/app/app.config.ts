import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideTaiga, TUI_DARK_MODE } from '@taiga-ui/core';
import { routes } from './app.routes';
import { Theme } from './theme';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideTaiga(),
    {
      provide: TUI_DARK_MODE,
      useFactory: () => {
        const theme = inject(Theme);
        return Object.assign(theme.dark, { reset: () => theme.set('dark') });
      },
    },
    provideClientHydration(
      withHttpTransferCacheOptions({ includeHeaders: ['server-timing', 'x-served-via'] }),
    ),
  ],
};
