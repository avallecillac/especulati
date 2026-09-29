import type { RelayStore } from './store.ts';

const MAX_BODY = 1024 * 1024;
const RATE_LIMIT = 120;
const RATE_KEEP_MINUTES = 10;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const SPACE_ID = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]+$/;
const IV = /^[A-Za-z0-9_-]{16}$/;
const UINT = /^\d{1,15}$/;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}
const err = (status: number, message: string, extra?: Record<string, string>) =>
  json(status, { error: message }, extra);

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(req: Request): string | null {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

/** Zero-knowledge relay: it only ever sees opaque `{ batchId, iv, ct }`. */
export async function handle(req: Request, store: RelayStore, now: () => number): Promise<Response> {
  try {
    return await route(req, store, now);
  } catch {
    return err(500, 'internal error');
  }
}

async function route(req: Request, store: RelayStore, now: () => number): Promise<Response> {
  const url = new URL(req.url);
  const m = /^\/api\/v1\/spaces\/([^/]+)(\/batches)?\/?$/.exec(url.pathname);
  if (!m) return err(404, 'not found');
  const id = m[1]!;
  const isBatches = m[2] !== undefined;
  const method = req.method;

  const allowed = isBatches ? ['POST', 'GET'] : ['PUT', 'GET', 'DELETE'];
  if (!allowed.includes(method)) return err(405, 'method not allowed', { allow: allowed.join(', ') });
  if (!SPACE_ID.test(id)) return err(400, 'bad request');

  const token = bearer(req);

  if (method === 'PUT') {
    if (token === null) return err(401, 'unauthorized');
    const created = await store.createSpace(id, await sha256hex(token), now());
    return created ? json(201, {}) : err(409, 'conflict');
  }

  const space = await store.getSpace(id);
  if (!space) return err(404, 'not found');
  if (token === null || !timingSafeEqual(await sha256hex(token), space.tokenHash)) {
    return err(401, 'unauthorized');
  }

  const t = now();
  const minute = Math.floor(t / 60_000);
  const count = await store.hit(id, minute);
  if (count === 1) await store.prune(minute - RATE_KEEP_MINUTES);
  if (count > RATE_LIMIT) {
    const retry = Math.max(1, 60 - Math.floor((t % 60_000) / 1000));
    return err(429, 'rate limited', { 'retry-after': String(retry) });
  }

  if (!isBatches) {
    if (method === 'DELETE') {
      await store.deleteSpace(id);
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    return json(200, { exists: true });
  }

  if (method === 'GET') {
    const after = url.searchParams.get('after') ?? '0';
    const limitRaw = url.searchParams.get('limit') ?? String(DEFAULT_LIMIT);
    if (!UINT.test(after) || !UINT.test(limitRaw)) return err(400, 'bad request');
    const limit = Number(limitRaw);
    if (limit < 1 || limit > MAX_LIMIT) return err(400, 'bad request');
    const rows = await store.listBatches(id, Number(after), limit + 1);
    return json(200, { batches: rows.slice(0, limit), more: rows.length > limit });
  }

  // POST
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY) return err(413, 'payload too large');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY) return err(413, 'payload too large');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return err(400, 'bad request');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return err(400, 'bad request');
  const { batchId, iv, ct } = body as Record<string, unknown>;
  if (
    typeof batchId !== 'string' ||
    !UUID.test(batchId) ||
    typeof iv !== 'string' ||
    !IV.test(iv) ||
    typeof ct !== 'string' ||
    !B64URL.test(ct)
  ) {
    return err(400, 'bad request');
  }
  const res = await store.appendBatch(id, { batchId: batchId.toLowerCase(), iv, ct }, t);
  return json(200, res);
}
