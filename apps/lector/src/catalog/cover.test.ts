import { describe, expect, it } from 'vitest';
import { fetchCover, toCoverUrl } from './cover.ts';

const u = 'https://covers.openlibrary.org/b/id/1-L.jpg';
const resp = (body: BodyInit, status = 200, type = 'image/jpeg') => () =>
  Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }));

describe('toCoverUrl', () => {
  it('builds the large cover URL', () => {
    expect(toCoverUrl(284550)).toBe('https://covers.openlibrary.org/b/id/284550-L.jpg');
  });
});

describe('fetchCover', () => {
  const big = new Uint8Array(2048);
  it('returns the blob for an image', async () => {
    const b = await fetchCover(u, { fetch: resp(big) });
    expect(b?.size).toBe(2048);
  });
  it('passes privacy options and a signal', async () => {
    let seen: RequestInit | undefined;
    const f = ((_: unknown, init?: RequestInit) => { seen = init; return resp(big)(); }) as typeof fetch;
    await fetchCover(u, { fetch: f });
    expect(seen).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(seen?.signal).toBeDefined();
  });
  it('returns null on non-2xx, non-image, tiny bodies, errors', async () => {
    expect(await fetchCover(u, { fetch: resp(big, 404) })).toBeNull();
    expect(await fetchCover(u, { fetch: resp(big, 200, 'text/html') })).toBeNull();
    expect(await fetchCover(u, { fetch: resp(new Uint8Array(1023)) })).toBeNull();
    expect(await fetchCover(u, { fetch: (() => Promise.reject(new TypeError('x'))) })).toBeNull();
  });
  it('returns null on timeout', async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as typeof fetch;
    expect(await fetchCover(u, { fetch: hang, timeoutMs: 30 })).toBeNull();
  });
});
