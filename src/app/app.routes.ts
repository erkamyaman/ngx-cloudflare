import { Routes } from '@angular/router';
import { Guestbook } from './guestbook/guestbook';

export const routes: Routes = [
  { path: '', component: Guestbook, title: 'Guestbook, rendered by ngx-cloudflare' },
  { path: '**', redirectTo: '' },
];
