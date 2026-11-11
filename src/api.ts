import { isInProcessRequest } from 'ngx-cloudflare/server';

import { SERVED_VIA_HEADER, type ServedVia } from './app/guestbook/entries-meta';
import { ENTRY_LIMITS, type Entry } from './app/guestbook/entry.model';

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

async function listEntries(request: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const { results } = await env.DB.prepare(
    'SELECT id, name, message, created_at FROM entries ORDER BY id DESC LIMIT 50',
  ).all<Entry>();
  return Response.json(results, {
    headers: {
      'server-timing': `d1;dur=${Date.now() - started}`,
      [SERVED_VIA_HEADER]: (isInProcessRequest(request)
        ? 'in-process'
        : 'network') satisfies ServedVia,
    },
  });
}

async function addEntry(request: Request, env: Env): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonError(400, 'Send JSON with name and message.');
  }
  const { name, message } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || typeof message !== 'string') {
    return jsonError(400, 'Send JSON with name and message.');
  }
  const cleanName = name.trim();
  const cleanMessage = message.trim();
  if (!cleanName || !cleanMessage) {
    return jsonError(422, 'Add your name and a message.');
  }
  if (cleanName.length > ENTRY_LIMITS.name || cleanMessage.length > ENTRY_LIMITS.message) {
    return jsonError(
      422,
      `Keep your name under ${ENTRY_LIMITS.name} characters and the message under ${ENTRY_LIMITS.message}.`,
    );
  }
  const entry = await env.DB.prepare(
    'INSERT INTO entries (name, message) VALUES (?, ?) RETURNING id, name, message, created_at',
  )
    .bind(cleanName, cleanMessage)
    .first<Entry>();
  return Response.json(entry, { status: 201 });
}

export async function api(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/entries') {
    if (request.method === 'GET') {
      return listEntries(request, env);
    }
    if (request.method === 'POST') {
      return addEntry(request, env);
    }
    return jsonError(405, 'Use GET or POST.');
  }
  return jsonError(404, 'Not found.');
}
