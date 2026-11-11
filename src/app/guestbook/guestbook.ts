import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  makeStateKey,
  PendingTasks,
  signal,
  TransferState,
} from '@angular/core';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { injectCloudflare } from 'ngx-cloudflare';
import type { Entry } from '../../api';

interface Visit {
  count: number;
  country: string | null;
  source: string;
}

const VISIT_KEY = makeStateKey<Visit>('visit');

@Component({
  selector: 'app-guestbook',
  imports: [FormField],
  templateUrl: './guestbook.html',
  styleUrl: './guestbook.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Guestbook {
  private readonly http = inject(HttpClient);
  private readonly state = inject(TransferState);

  protected readonly entries = httpResource<Entry[]>(() => '/api/entries', { defaultValue: [] });
  protected readonly visit = signal<Visit | null>(this.state.get(VISIT_KEY, null));
  protected readonly added = signal<Entry[]>([]);
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly model = signal({ name: '', message: '' });
  protected readonly entryForm = form(this.model, (path) => {
    required(path.name, { message: 'Add your name.' });
    maxLength(path.name, 60);
    required(path.message, { message: 'Write a message.' });
    maxLength(path.message, 500);
  });

  constructor() {
    const cloudflare = injectCloudflare<Env>();
    if (cloudflare) {
      inject(PendingTasks).run(async () => {
        const previous = Number((await cloudflare.env.VISITS.get('count')) ?? 0);
        const visit: Visit = {
          count: previous + 1,
          country: typeof cloudflare.cf?.['country'] === 'string' ? cloudflare.cf['country'] : null,
          source: cloudflare.source,
        };
        cloudflare.ctx.waitUntil(cloudflare.env.VISITS.put('count', String(visit.count)));
        this.state.set(VISIT_KEY, visit);
        this.visit.set(visit);
      });
    }
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.entryForm().invalid() || this.sending()) {
      this.entryForm.name().markAsTouched();
      this.entryForm.message().markAsTouched();
      return;
    }
    this.sending.set(true);
    this.error.set(null);
    this.http.post<Entry>('/api/entries', this.model()).subscribe({
      next: (entry) => {
        this.added.update((list) => [entry, ...list]);
        this.model.set({ name: this.model().name, message: '' });
        this.entryForm.message().reset();
        this.sending.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(err.error?.message ?? 'Could not save your message. Try again.');
        this.sending.set(false);
      },
    });
  }
}
