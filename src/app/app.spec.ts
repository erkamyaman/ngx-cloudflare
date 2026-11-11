import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { appConfig } from './app.config';

describe('App', () => {
  it('wraps the routed page in tui-root', () => {
    TestBed.configureTestingModule({ imports: [App], providers: appConfig.providers });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = (fixture.nativeElement as HTMLElement).querySelector('tui-root');
    expect(root?.querySelector('router-outlet')).not.toBeNull();
  });
});
