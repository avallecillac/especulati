import type { Fetch } from './types.ts';

export type KeyTestResult =
  | { kind: 'ok' }
  | { kind: 'rejected' }
  | { kind: 'refererBlocked' }
  | { kind: 'quota' }
  | { kind: 'offline' }
  | { kind: 'other'; status: number };

/** Request #3 for a known ISBN, sent with the key. The key never appears in the result. */
export async function testGoogleKey(key: string, deps: { fetch: Fetch; timeoutMs?: number }): Promise<KeyTestResult> {
  const url = 'https://www.googleapis.com/books/v1/volumes?q=isbn:9780441172719&maxResults=1';
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await deps.fetch(`${url}&key=${encodeURIComponent(key)}`, {
      credentials: 'omit',
      referrerPolicy: 'strict-origin',
      cache: 'no-store',
      signal,
    });
  } catch {
    return { kind: 'offline' };
  }
  if (res.ok) return { kind: 'ok' };
  if (res.status === 429) return { kind: 'quota' };
  const body = await res.text().catch(() => '');
  if (res.status === 400 && body.includes('API key not valid')) return { kind: 'rejected' };
  if (res.status === 403 && (body.includes('API_KEY_HTTP_REFERRER_BLOCKED') || /referer/i.test(body))) {
    return { kind: 'refererBlocked' };
  }
  return { kind: 'other', status: res.status };
}
