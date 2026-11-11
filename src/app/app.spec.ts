import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Guestbook } from './guestbook/guestbook';

describe('Guestbook', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Guestbook],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('renders the entries from the API', async () => {
    const fixture = TestBed.createComponent(Guestbook);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne('/api/entries')
      .flush([{ id: 1, name: 'Ada', message: 'Hello', created_at: '2026-11-11T00:00:00Z' }]);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ada');
    expect(text).toContain('Hello');
  });

  it('shows no visit counter outside a Cloudflare request', async () => {
    const fixture = TestBed.createComponent(Guestbook);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/entries').flush([]);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('#visit')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No entries yet');
  });
});
