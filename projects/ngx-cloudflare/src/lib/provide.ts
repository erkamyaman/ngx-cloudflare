import { FetchBackend, HttpBackend } from '@angular/common/http';
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { CloudflareFetchBackend } from './http-backend';

export interface ProvideCloudflareOptions {
  inProcessRequests?: boolean;
}

export function provideCloudflare(options: ProvideCloudflareOptions = {}): EnvironmentProviders {
  if (options.inProcessRequests === false) {
    return makeEnvironmentProviders([]);
  }
  return makeEnvironmentProviders([
    CloudflareFetchBackend,
    { provide: FetchBackend, useExisting: CloudflareFetchBackend },
    { provide: HttpBackend, useExisting: CloudflareFetchBackend },
  ]);
}
