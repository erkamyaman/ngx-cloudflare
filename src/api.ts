import { isInProcessRequest } from 'ngx-cloudflare/server';

import type { Entry } from './app/guestbook/entry.model';

const MAX_NAME = 60;
const MAX_MESSAGE = 500;

function problem(status: number, message: string): Response {
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
      'x-served-via': isInProcessRequest(request) ? 'in-process' : 'network',
    },
  });
}

async function addEntry(request: Request, env: Env): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, 'Send JSON with name and message.');
  }
  const { name, message } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || typeof message !== 'string') {
    return problem(400, 'Send JSON with name and message.');
  }
  const cleanName = name.trim();
  const cleanMessage = message.trim();
  if (!cleanName || !cleanMessage) {
    return problem(422, 'Add your name and a message.');
  }
  if (cleanName.length > MAX_NAME || cleanMessage.length > MAX_MESSAGE) {
    return problem(
      422,
      `Keep your name under ${MAX_NAME} characters and the message under ${MAX_MESSAGE}.`,
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
    return problem(405, 'Use GET or POST.');
  }
  return problem(404, 'Not found.');
}
