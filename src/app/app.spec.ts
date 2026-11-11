import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideCloudflareTesting } from 'ngx-cloudflare/testing';
import { Guestbook } from './guestbook/guestbook';

const entry = { id: 1, name: 'Ada', message: 'Hello', created_at: '2026-11-11T00:00:00Z' };

function setup(cloudflare = false) {
  const store = new Map<string, string>([['count', '41']]);
  TestBed.configureTestingModule({
    imports: [Guestbook],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      cloudflare
        ? provideCloudflareTesting({
            url: 'https://demo.someone.workers.dev/',
            cf: { colo: 'AMS', country: 'NL' },
            env: {
              VISITS: {
                get: async (key: string) => store.get(key) ?? null,
                put: async (key: string, value: string) => void store.set(key, value),
              } as unknown as KVNamespace,
            },
          })
        : [],
    ],
  });
  const fixture = TestBed.createComponent(Guestbook);
  fixture.detectChanges();
  return { fixture, http: TestBed.inject(HttpTestingController), store };
}

describe('Guestbook', () => {
  it('lists the entries from the API', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([entry]);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).querySelector('#entries')?.textContent;
    expect(text).toContain('Ada');
    expect(text).toContain('Hello');
  });

  it('invites the first signature when there are no entries', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([]);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nobody has signed yet');
  });

  it('explains the missing trace outside a server request', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([]);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no server trace');
  });

  it('shows the source of the Worker entry', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([]);
    await fixture.whenStable();
    const source = (fixture.nativeElement as HTMLElement).querySelector('.source')!.textContent!;
    expect(source).toContain('src/server.ts');
    expect(source).toContain('createCloudflareRequestHandler<Env>({ api })');
  });

  it('confirms a signature and puts it at the top', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([entry]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const name = el.querySelector<HTMLInputElement>('#name')!;
    const message = el.querySelector<HTMLTextAreaElement>('#message')!;
    name.value = 'Grace';
    name.dispatchEvent(new Event('input'));
    message.value = 'Hi from a test';
    message.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await Promise.resolve();
    http
      .expectOne({ method: 'POST', url: '/api/entries' })
      .flush({ ...entry, id: 2, name: 'Grace', message: 'Hi from a test' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Signed, Grace.');
    expect(el.querySelector('#entries li')!.textContent).toContain('Hi from a test');
  });

  it('marks empty fields as invalid on submit', async () => {
    const { fixture, http } = setup();
    http.expectOne('/api/entries').flush([]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(el.querySelector('#name')!.getAttribute('aria-invalid')).toBe('true');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('#name-error')!.textContent).toContain('Add your name.');
    http.expectNone('/api/entries');
  });

  it('traces the request from the Cloudflare bindings and counts the visit', async () => {
    const { fixture, http, store } = setup(true);
    http
      .expectOne('/api/entries')
      .flush([entry], { headers: { 'x-served-via': 'in-process', 'server-timing': 'd1;dur=4' } });
    await fixture.whenStable();
    fixture.detectChanges();
    const trace = (fixture.nativeElement as HTMLElement).querySelector('.trace')!.textContent!;
    expect(trace).toContain('GET /');
    expect(trace).toContain('allowedHosts matched *.workers.dev');
    expect(trace).toContain('colo=AMS country=NL');
    expect(trace).toContain("VISITS.get('count') = 41");
    expect(trace).toContain('put(42) in ctx.waitUntil()');
    expect(trace).toContain('in-process via dispatch()');
    expect(trace).toContain('4 ms (Server-Timing)');
    expect(store.get('count')).toBe('42');
  });
});
