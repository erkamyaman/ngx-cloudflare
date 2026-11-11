import { Routes } from '@angular/router';
import { Guestbook } from './guestbook/guestbook';

export const routes: Routes = [
  { path: '', component: Guestbook, title: 'Guestbook · ngx-cloudflare' },
  { path: '**', redirectTo: '' },
];
