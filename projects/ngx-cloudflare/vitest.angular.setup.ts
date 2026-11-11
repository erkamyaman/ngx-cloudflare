import '@angular/compiler';
import * as core from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

const angular = core as typeof core & {
  provideExperimentalZonelessChangeDetection?: () => core.EnvironmentProviders;
};
const provideZoneless =
  angular.provideZonelessChangeDetection ?? angular.provideExperimentalZonelessChangeDetection!;

@core.NgModule({ providers: [provideZoneless()] })
class ZonelessTestingModule {}

getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestingModule],
  platformBrowserTesting(),
);
