import type { CloudflareContext } from 'ngx-cloudflare';

export interface VisitRecord {
  count: number;
  previous: string | null;
  current: string;
}

const COUNT_VISIT = `INSERT INTO counters (name, value) VALUES ('visits', 1)
  ON CONFLICT (name) DO UPDATE SET value = value + 1
  RETURNING value`;

const LAST_VISIT_KEY = 'last-visit';

export async function recordVisit(cloudflare: CloudflareContext<Env>): Promise<VisitRecord> {
  const { env, ctx, cf } = cloudflare;
  const [row, previous] = await Promise.all([
    env.DB.prepare(COUNT_VISIT).first<{ value: number }>(),
    env.VISITS.get(LAST_VISIT_KEY),
  ]);
  const current = `${String(cf?.['country'] ?? '??')} via ${String(cf?.['colo'] ?? 'local')}`;
  ctx.waitUntil(env.VISITS.put(LAST_VISIT_KEY, current));
  return { count: row?.value ?? 0, previous, current };
}
