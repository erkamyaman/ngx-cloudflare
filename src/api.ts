export interface Entry {
  id: number;
  name: string;
  message: string;
  created_at: string;
}

const MAX_NAME = 60;
const MAX_MESSAGE = 500;

function problem(status: number, message: string): Response {
  return Response.json({ message }, { status });
}

async function listEntries(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, name, message, created_at FROM entries ORDER BY id DESC LIMIT 50',
  ).all<Entry>();
  return Response.json(results);
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
    return problem(422, 'Name and message are required.');
  }
  if (cleanName.length > MAX_NAME || cleanMessage.length > MAX_MESSAGE) {
    return problem(
      422,
      `Keep the name under ${MAX_NAME} and the message under ${MAX_MESSAGE} characters.`,
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
      return listEntries(env);
    }
    if (request.method === 'POST') {
      return addEntry(request, env);
    }
    return problem(405, 'Use GET or POST.');
  }
  return problem(404, 'Not found.');
}
