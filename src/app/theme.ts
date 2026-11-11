import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { effect, inject, Injectable, PLATFORM_ID, REQUEST, signal } from '@angular/core';

export type ThemeName = 'dark' | 'light';

const COOKIE = 'theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly request = inject(REQUEST, { optional: true });

  readonly dark = signal(this.saved() !== 'light');

  constructor() {
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.dark() ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.set(this.dark() ? 'light' : 'dark');
  }

  set(theme: ThemeName): void {
    this.dark.set(theme === 'dark');
    if (this.browser) {
      this.document.cookie = `${COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    }
  }

  private saved(): ThemeName | null {
    const cookies = this.browser
      ? this.document.cookie
      : (this.request?.headers.get('cookie') ?? '');
    const match = new RegExp(`(?:^|;\\s*)${COOKIE}=(dark|light)`).exec(cookies);
    return (match?.[1] as ThemeName | undefined) ?? null;
  }
}
