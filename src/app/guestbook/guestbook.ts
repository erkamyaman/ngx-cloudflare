import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  makeStateKey,
  PendingTasks,
  REQUEST,
  signal,
  TransferState,
  VERSION,
} from '@angular/core';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { DomSanitizer } from '@angular/platform-browser';
import {
  TuiButton,
  TuiError,
  TuiInput,
  TuiLabel,
  TuiLink,
  TuiNotification,
  TuiTextfield,
} from '@taiga-ui/core';
import { TuiButtonCopy, TuiButtonLoading, TuiTextarea } from '@taiga-ui/kit';
import { injectCloudflare } from 'ngx-cloudflare';
import { firstValueFrom } from 'rxjs';
import { Theme } from '../theme';
import { CODE_SAMPLES } from './code-samples.generated';
import type { Entry } from './entry.model';
import { createRequestTrace, EntriesMeta, readEntriesMeta, RequestTrace } from './request-trace';

const TRACE_KEY = makeStateKey<RequestTrace>('trace');
const ENTRIES_META_KEY = makeStateKey<EntriesMeta>('entries-meta');

@Component({
  selector: 'app-guestbook',
  imports: [
    FormField,
    DatePipe,
    TuiButton,
    TuiButtonCopy,
    TuiButtonLoading,
    TuiError,
    TuiInput,
    TuiLabel,
    TuiLink,
    TuiNotification,
    TuiTextarea,
    TuiTextfield,
  ],
  templateUrl: './guestbook.html',
  styleUrl: './guestbook.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Guestbook {
  protected readonly theme = inject(Theme);
  private readonly http = inject(HttpClient);
  private readonly state = inject(TransferState);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly pendingTasks = inject(PendingTasks);
  private readonly request = inject(REQUEST, { optional: true });
  private readonly cloudflare = injectCloudflare<Env>();

  protected readonly entries = httpResource<Entry[]>(() => '/api/entries', { defaultValue: [] });
  protected readonly trace = signal<RequestTrace | null>(this.state.get(TRACE_KEY, null));
  protected readonly added = signal<Entry[]>([]);
  protected readonly error = signal('');
  protected readonly signedAs = signal('');
  protected readonly browserRequests = signal<number | null>(null);
  protected readonly angularVersion = VERSION.full;
  protected readonly samples = CODE_SAMPLES.map((sample) => ({
    ...sample,
    html: this.sanitizer.bypassSecurityTrustHtml(sample.html),
  }));

  protected readonly model = signal({ name: '', message: '' });
  protected readonly entryForm = form(this.model, (path) => {
    required(path.name, { message: 'Add your name.' });
    maxLength(path.name, 60, { message: 'Keep your name under 60 characters.' });
    required(path.message, { message: 'Write a message.' });
    maxLength(path.message, 500, { message: 'Keep the message under 500 characters.' });
  });
  protected readonly nameInvalid = computed(
    () => this.entryForm.name().touched() && this.entryForm.name().invalid(),
  );
  protected readonly messageInvalid = computed(
    () => this.entryForm.message().touched() && this.entryForm.message().invalid(),
  );

  private readonly liveMeta = computed(() => {
    const headers = this.entries.headers();
    return headers ? readEntriesMeta(headers) : null;
  });
  private readonly entriesMeta = computed(
    () => this.liveMeta() ?? this.state.get(ENTRIES_META_KEY, null),
  );
  protected readonly servedVia = computed(() => this.entriesMeta()?.servedVia ?? null);
  protected readonly fetchedInProcess = computed(() => this.servedVia() === 'in-process');
  protected readonly d1Ms = computed(() => this.entriesMeta()?.d1Ms ?? null);
  protected readonly cacheHit = computed(() => this.browserRequests() === 0);
  protected readonly refetched = computed(() => (this.browserRequests() ?? 0) > 0);
  protected readonly themeIcon = computed(() => (this.theme.dark() ? '@tui.sun' : '@tui.moon'));
  protected readonly themeLabel = computed(() =>
    this.theme.dark() ? 'Switch to light mode' : 'Switch to dark mode',
  );

  constructor() {
    if (this.cloudflare && this.request) {
      this.pendingTasks.run(() => this.traceRequest());
      effect(() => this.transferEntriesMeta());
    }
    afterNextRender(() => this.countBrowserFetches());
  }

  protected signGuestbook(event: Event): void {
    event.preventDefault();
    this.error.set('');
    this.signedAs.set('');
    void submit(this.entryForm, async () => {
      try {
        const entry = await firstValueFrom(this.http.post<Entry>('/api/entries', this.model()));
        this.added.update((list) => [entry, ...list]);
        this.signedAs.set(entry.name);
        this.model.update((value) => ({ ...value, message: '' }));
        this.entryForm.message().reset();
      } catch (err) {
        this.error.set(this.describeError(err));
      }
    });
  }

  private async traceRequest(): Promise<void> {
    const { env, ctx } = this.cloudflare!;
    const visitsBefore = Number((await env.VISITS.get('count')) ?? 0);
    const trace = createRequestTrace(this.request!, this.cloudflare!, visitsBefore);
    ctx.waitUntil(env.VISITS.put('count', String(trace.visit)));
    this.state.set(TRACE_KEY, trace);
    this.trace.set(trace);
  }

  private transferEntriesMeta(): void {
    const meta = this.liveMeta();
    if (meta) {
      this.state.set(ENTRIES_META_KEY, meta);
    }
  }

  private countBrowserFetches(): void {
    const requests = performance
      .getEntriesByType('resource')
      .filter((entry) => new URL(entry.name).pathname === '/api/entries');
    this.browserRequests.set(requests.length);
  }

  private describeError(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 0) {
      return 'Your entry was not saved because the connection dropped. Try again.';
    }
    if (err instanceof HttpErrorResponse && typeof err.error?.message === 'string') {
      return err.error.message;
    }
    return 'Your entry was not saved. Try again.';
  }
}
