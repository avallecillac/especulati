import { describe, expect, it } from 'vitest';
import { handle } from '../src/handler.ts';
import { sqliteStore, type TestStore } from './sqliteStore.ts';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const TOKEN_A = 'token-a-fixed-fake';
const TOKEN_B = 'token-b-fixed-fake';
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const IV = 'AAAAAAAAAAAAAAAA'; // 16 base64url chars = 12 bytes
const bid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface Env {
  store: TestStore;
  clock: { t: number };
  call(method: string, path: string, opts?: { token?: string | null; body?: unknown; raw?: string }): Promise<Response>;
}

function setup(): Env {
  const store = sqliteStore();
  const clock = { t: T0 };
  return {
    store,
    clock,
    call(method, path, opts = {}) {
      const headers: Record<string, string> = {};
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = body;
      return handle(new Request(`https://x.test/api/v1${path}`, init), store, () => clock.t);
    },
  };
}

const post = (e: Env, id: string, token: string, n: number, ct = 'Y2lwaGVy') =>
  e.call('POST', `/spaces/${id}/batches`, { token, body: { batchId: bid(n), iv: IV, ct } });

describe('relay handler', () => {
  it('creates, checks, and deletes a space', async () => {
    const e = setup();
    const created = await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({});
    const got = await e.call('GET', `/spaces/${A}`, { token: TOKEN_A });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ exists: true });
    await post(e, A, TOKEN_A, 1);
    const del = await e.call('DELETE', `/spaces/${A}`, { token: TOKEN_A });
    expect(del.status).toBe(204);
    expect((await e.call('GET', `/spaces/${A}`, { token: TOKEN_A })).status).toBe(404);
    expect(e.store.dumpAll()).toBe('');
  });

  it('PUT on an existing space is 409; bad ids are 400', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    expect((await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A })).status).toBe(409);
    expect((await e.call('PUT', `/spaces/${A}`, { token: TOKEN_B })).status).toBe(409);
    for (const bad of ['abc', 'A'.repeat(32), 'g'.repeat(32), 'a'.repeat(33)]) {
      expect((await e.call('PUT', `/spaces/${bad}`, { token: TOKEN_A })).status).toBe(400);
    }
  });

  it('401 for wrong or missing token, 404 for unknown space', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    for (const token of [TOKEN_B, null]) {
      expect((await e.call('GET', `/spaces/${A}`, { token })).status).toBe(401);
      expect((await e.call('DELETE', `/spaces/${A}`, { token })).status).toBe(401);
      expect((await e.call('GET', `/spaces/${A}/batches?after=0`, { token })).status).toBe(401);
      expect(
        (await e.call('POST', `/spaces/${A}/batches`, { token, body: { batchId: bid(1), iv: IV, ct: 'YQ' } })).status,
      ).toBe(401);
    }
    expect((await e.call('GET', `/spaces/${B}`, { token: TOKEN_A })).status).toBe(404);
    expect((await e.call('DELETE', `/spaces/${B}`, { token: TOKEN_A })).status).toBe(404);
    expect((await post(e, B, TOKEN_A, 1)).status).toBe(404);
    expect((await e.call('GET', `/spaces/${B}/batches`, { token: TOKEN_A })).status).toBe(404);
  });

  it('no cross-space access even with another space valid token', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    await e.call('PUT', `/spaces/${B}`, { token: TOKEN_B });
    await post(e, A, TOKEN_A, 1);
    expect((await post(e, A, TOKEN_B, 2)).status).toBe(401);
    expect((await e.call('GET', `/spaces/${A}/batches`, { token: TOKEN_B })).status).toBe(401);
    const listB = (await (await e.call('GET', `/spaces/${B}/batches`, { token: TOKEN_B })).json()) as {
      batches: unknown[];
    };
    expect(listB.batches).toEqual([]);
    // Deleting B leaves A's batches.
    await e.call('DELETE', `/spaces/${B}`, { token: TOKEN_B });
    const listA = (await (await e.call('GET', `/spaces/${A}/batches`, { token: TOKEN_A })).json()) as {
      batches: unknown[];
    };
    expect(listA.batches).toHaveLength(1);
  });

  it('posts and lists with after / limit / more', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const seqs: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = await post(e, A, TOKEN_A, i, `Y3Q${i}`);
      expect(r.status).toBe(200);
      const j = (await r.json()) as { seq: number; duplicate: boolean };
      expect(j.duplicate).toBe(false);
      seqs.push(j.seq);
    }
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    type List = { batches: { seq: number; batchId: string; iv: string; ct: string }[]; more: boolean };
    const first = (await (await e.call('GET', `/spaces/${A}/batches?after=0&limit=2`, { token: TOKEN_A })).json()) as List;
    expect(first.batches.map((b) => b.seq)).toEqual(seqs.slice(0, 2));
    expect(first.batches[0]).toEqual({ seq: seqs[0], batchId: bid(1), iv: IV, ct: 'Y3Q1' });
    expect(first.more).toBe(true);
    const rest = (await (
      await e.call('GET', `/spaces/${A}/batches?after=${seqs[1]}&limit=100`, { token: TOKEN_A })
    ).json()) as List;
    expect(rest.batches.map((b) => b.seq)).toEqual(seqs.slice(2));
    expect(rest.more).toBe(false);
    const exact = (await (await e.call('GET', `/spaces/${A}/batches?after=${seqs[1]}&limit=3`, { token: TOKEN_A })).json()) as List;
    expect(exact.batches).toHaveLength(3);
    expect(exact.more).toBe(false);
    for (const q of ['after=-1', 'after=x', 'limit=0', 'limit=101', 'limit=abc', 'after=1.5']) {
      expect((await e.call('GET', `/spaces/${A}/batches?${q}`, { token: TOKEN_A })).status).toBe(400);
    }
  });

  it('idempotent re-POST returns the same seq with duplicate: true', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const one = (await (await post(e, A, TOKEN_A, 1)).json()) as { seq: number };
    await post(e, A, TOKEN_A, 2);
    const again = (await (await post(e, A, TOKEN_A, 1)).json()) as { seq: number; duplicate: boolean };
    expect(again).toEqual({ seq: one.seq, duplicate: true });
    const list = (await (await e.call('GET', `/spaces/${A}/batches`, { token: TOKEN_A })).json()) as {
      batches: unknown[];
    };
    expect(list.batches).toHaveLength(2);
  });

  it('rejects malformed batch bodies with 400', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const bad: unknown[] = [
      { batchId: 'nope', iv: IV, ct: 'YQ' },
      { batchId: bid(1), iv: 'short', ct: 'YQ' },
      { batchId: bid(1), iv: 'AAAAAAAAAAAAAAA+', ct: 'YQ' },
      { batchId: bid(1), iv: IV, ct: '' },
      { batchId: bid(1), iv: IV, ct: 'a b' },
      { batchId: bid(1), iv: IV },
      { batchId: 1, iv: IV, ct: 'YQ' },
      [],
      null,
    ];
    for (const body of bad) {
      expect((await e.call('POST', `/spaces/${A}/batches`, { token: TOKEN_A, body })).status).toBe(400);
    }
    expect((await e.call('POST', `/spaces/${A}/batches`, { token: TOKEN_A, raw: '{not json' })).status).toBe(400);
  });

  it('413 over 1 MiB', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const r = await post(e, A, TOKEN_A, 1, 'A'.repeat(1024 * 1024 + 1));
    expect(r.status).toBe(413);
    const ok = await post(e, A, TOKEN_A, 2, 'A'.repeat(1024 * 1024 - 1000));
    expect(ok.status).toBe(200);
  });

  it('429 after 120 requests in a minute, then allowed in the next minute', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    for (let i = 0; i < 120; i++) {
      expect((await e.call('GET', `/spaces/${A}`, { token: TOKEN_A })).status).toBe(200);
    }
    const limited = await e.call('GET', `/spaces/${A}`, { token: TOKEN_A });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('cache-control')).toBe('no-store');
    // Other spaces are unaffected.
    await e.call('PUT', `/spaces/${B}`, { token: TOKEN_B });
    expect((await e.call('GET', `/spaces/${B}`, { token: TOKEN_B })).status).toBe(200);
    e.clock.t += 60_000;
    expect((await e.call('GET', `/spaces/${A}`, { token: TOKEN_A })).status).toBe(200);
  });

  it('prunes stale rate rows', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    await e.call('GET', `/spaces/${A}`, { token: TOKEN_A });
    expect(e.store.dumpAll()).toContain('"minute"');
    e.clock.t += 11 * 60_000;
    await e.call('GET', `/spaces/${A}`, { token: TOKEN_A });
    const minutes = e.store
      .dumpAll()
      .split('\n')
      .filter((l) => l.includes('"minute"'));
    expect(minutes).toHaveLength(1);
  });

  it('sets Cache-Control: no-store on every response', async () => {
    const e = setup();
    const all: Response[] = [
      await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A }),
      await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A }),
      await e.call('PUT', '/spaces/zz', { token: TOKEN_A }),
      await e.call('GET', `/spaces/${A}`, { token: null }),
      await e.call('GET', `/spaces/${B}`, { token: TOKEN_A }),
      await e.call('GET', `/spaces/${A}`, { token: TOKEN_A }),
      await post(e, A, TOKEN_A, 1),
      await e.call('GET', `/spaces/${A}/batches`, { token: TOKEN_A }),
      await e.call('GET', '/nowhere', { token: TOKEN_A }),
      await e.call('PATCH', `/spaces/${A}`, { token: TOKEN_A }),
      await e.call('DELETE', `/spaces/${A}`, { token: TOKEN_A }),
    ];
    for (const r of all) expect(r.headers.get('cache-control')).toBe('no-store');
    expect(all[8]!.status).toBe(404);
    expect(all[9]!.status).toBe(405);
  });

  it('error bodies are { error } and never echo input', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const secret = 'SECRET-MARKER';
    const errs: Response[] = [
      await e.call('GET', `/spaces/${A}`, { token: secret }),
      await e.call('GET', `/spaces/${B}`, { token: secret }),
      await e.call('PUT', `/spaces/${secret}`, { token: secret }),
      await e.call('POST', `/spaces/${A}/batches`, { token: TOKEN_A, body: { batchId: secret, iv: secret, ct: secret } }),
      await e.call('POST', `/spaces/${A}/batches`, { token: TOKEN_A, raw: secret }),
      await e.call('GET', `/spaces/${A}/batches?after=${secret}`, { token: TOKEN_A }),
      await e.call('GET', `/${secret}`, { token: secret }),
    ];
    for (const r of errs) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      const text = await r.text();
      const j = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(j)).toEqual(['error']);
      expect(typeof j.error).toBe('string');
      expect(text).not.toContain(secret);
      expect(text).not.toContain(A);
    }
  });

  it('stores no plaintext (SC-005 scan)', async () => {
    const e = setup();
    await e.call('PUT', `/spaces/${A}`, { token: TOKEN_A });
    const plain = 'devices op_id books title The Left Hand of Darkness';
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const b64u = (u: Uint8Array) => Buffer.from(u).toString('base64url');
    for (let i = 1; i <= 3; i++) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
      const r = await e.call('POST', `/spaces/${A}/batches`, {
        token: TOKEN_A,
        body: { batchId: bid(i), iv: b64u(iv), ct: b64u(ct) },
      });
      expect(r.status).toBe(200);
    }
    const dump = e.store.dumpAll();
    for (const word of ['Darkness', 'Left Hand', 'op_id', 'title', TOKEN_A]) expect(dump).not.toContain(word);
  });
});
