import { FetchBackend, HttpBackend } from '@angular/common/http';
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { ɵCloudflareFetchBackend } from './cloudflare-fetch-backend';

export interface ProvideCloudflareOptions {
  inProcessRequests?: boolean;
}

export function provideCloudflare(options: ProvideCloudflareOptions = {}): EnvironmentProviders {
  if (options.inProcessRequests === false) {
    return makeEnvironmentProviders([]);
  }
  return makeEnvironmentProviders([
    ɵCloudflareFetchBackend,
    { provide: FetchBackend, useExisting: ɵCloudflareFetchBackend },
    { provide: HttpBackend, useExisting: ɵCloudflareFetchBackend },
  ]);
}
