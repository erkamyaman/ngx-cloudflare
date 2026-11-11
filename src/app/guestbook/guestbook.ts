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
import { type CloudflareContext, injectCloudflare } from 'ngx-cloudflare';
import { firstValueFrom } from 'rxjs';
import { Theme } from '../theme';
import { CODE_SAMPLES } from './code-samples.generated';
import { EntriesMeta, readEntriesMeta } from './entries-meta';
import { ENTRY_LIMITS, type Entry } from './entry.model';
import { createRequestTrace, RequestTrace } from './request-trace';
import { recordVisit } from './visit-log';

type SignState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'signed'; name: string }
  | { kind: 'failed'; message: string };

type FetchState = 'loading' | 'failed' | 'in-process' | 'network' | 'unlabelled';

type HydrationCheck =
  { kind: 'pending' } | { kind: 'cache-hit' } | { kind: 'refetched'; count: number };

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
  protected readonly signState = signal<SignState>({ kind: 'idle' });
  protected readonly hydration = signal<HydrationCheck>({ kind: 'pending' });
  protected readonly angularVersion = VERSION.full;
  protected readonly limits = ENTRY_LIMITS;
  protected readonly samples = CODE_SAMPLES.map((sample) => ({
    ...sample,
    html: this.sanitizer.bypassSecurityTrustHtml(sample.html),
  }));

  protected readonly model = signal({ name: '', message: '' });
  protected readonly entryForm = form(this.model, (path) => {
    required(path.name, { message: 'Add your name.' });
    maxLength(path.name, ENTRY_LIMITS.name, {
      message: `Keep your name under ${ENTRY_LIMITS.name} characters.`,
    });
    required(path.message, { message: 'Write a message.' });
    maxLength(path.message, ENTRY_LIMITS.message, {
      message: `Keep the message under ${ENTRY_LIMITS.message} characters.`,
    });
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
  protected readonly fetchState = computed<FetchState>(() => {
    const status = this.entries.status();
    if (status === 'error') {
      return 'failed';
    }
    const servedVia = this.entriesMeta()?.servedVia;
    if (servedVia) {
      return servedVia;
    }
    return status === 'loading' || status === 'reloading' ? 'loading' : 'unlabelled';
  });
  protected readonly d1Ms = computed(() => this.entriesMeta()?.d1Ms ?? null);
  protected readonly signing = computed(() => this.signState().kind === 'signing');
  protected readonly signedName = computed(() => {
    const state = this.signState();
    return state.kind === 'signed' ? state.name : '';
  });
  protected readonly signError = computed(() => {
    const state = this.signState();
    return state.kind === 'failed' ? state.message : '';
  });
  protected readonly refetchCount = computed(() => {
    const check = this.hydration();
    return check.kind === 'refetched' ? check.count : 0;
  });
  protected readonly visibleEntries = computed(() => {
    const fresh = this.added();
    const freshIds = new Set(fresh.map((entry) => entry.id));
    return [
      ...fresh.map((entry) => ({ ...entry, fresh: true })),
      ...(this.entries.hasValue() ? this.entries.value() : [])
        .filter((entry) => !freshIds.has(entry.id))
        .map((entry) => ({ ...entry, fresh: false })),
    ];
  });
  protected readonly showEmptyMessage = computed(
    () => this.visibleEntries().length === 0 && !this.entries.isLoading() && !this.entries.error(),
  );
  protected readonly bindingList = computed(() => this.trace()?.bindings.join(' ') ?? '');
  protected readonly themeIcon = computed(() => (this.theme.dark() ? '@tui.sun' : '@tui.moon'));
  protected readonly themeLabel = computed(() =>
    this.theme.dark() ? 'Switch to light mode' : 'Switch to dark mode',
  );

  constructor() {
    const cloudflare = this.cloudflare;
    const request = this.request;
    if (cloudflare && request) {
      this.pendingTasks.run(() => this.traceRequest(cloudflare, request));
      effect(() => this.transferEntriesMeta());
    }
    afterNextRender(() => this.countBrowserFetches());
  }

  protected signGuestbook(event: Event): void {
    event.preventDefault();
    if (this.signing()) {
      return;
    }
    void submit(this.entryForm, async () => {
      this.signState.set({ kind: 'signing' });
      try {
        const entry = await firstValueFrom(this.http.post<Entry>('/api/entries', this.model()));
        this.added.update((list) => [entry, ...list]);
        this.model.update((value) => ({ ...value, message: '' }));
        this.entryForm.message().reset();
        this.signState.set({ kind: 'signed', name: entry.name });
      } catch (err) {
        this.signState.set({ kind: 'failed', message: this.describeError(err) });
      }
    });
  }

  private async traceRequest(cloudflare: CloudflareContext<Env>, request: Request): Promise<void> {
    const visit = await recordVisit(cloudflare);
    const trace = createRequestTrace(request, cloudflare, visit);
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
    this.hydration.set(
      requests.length === 0 ? { kind: 'cache-hit' } : { kind: 'refetched', count: requests.length },
    );
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
