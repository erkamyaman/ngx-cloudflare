import type { HttpHeaders } from '@angular/common/http';

export type ServedVia = 'in-process' | 'network';

export interface EntriesMeta {
  servedVia: ServedVia | null;
  d1Ms: number | null;
}

export const SERVED_VIA_HEADER = 'x-served-via';

export function readEntriesMeta(headers: HttpHeaders): EntriesMeta {
  const match = /d1;dur=([\d.]+)/.exec(headers.get('server-timing') ?? '');
  const servedVia = headers.get(SERVED_VIA_HEADER);
  return {
    servedVia: servedVia === 'in-process' || servedVia === 'network' ? servedVia : null,
    d1Ms: match ? Number(match[1]) : null,
  };
}
