import { describe, expect, it } from 'vitest';
import { formatSyncCode } from '../src/code.ts';
import { createCapturePeer, type CaptureStore } from '../src/capturePeer.ts';
import { uuidFromHash } from '../src/ids.ts';
import { fakeRelay, makePeer, prng, randomBytes, type FakeRelay, type Peer } from './harness.ts';

const ORIGIN = 'https://readerlog.test';
const memStore = (): CaptureStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    get<T>(k: string) {
      return Promise.resolve(data.has(k) ? (structuredClone(data.get(k)) as T) : undefined);
    },
    set(patch) {
      for (const [k, v] of Object.entries(patch)) data.set(k, structuredClone(v));
      return Promise.resolve();
    },
  };
};

function setup(relay: FakeRelay) {
  let wall = Date.UTC(2026, 8, 28, 9, 0, 0);
  const state = { online: true };
  const store = memStore();
  const peer = createCapturePeer(store, {
    fetch: relay.fetch,
    now: () => wall,
    random: randomBytes(prng(77)),
    online: () => state.online,
  });
  return { store, peer, state, tick: (ms = 1000) => (wall += ms) };
}

async function host(relay: FakeRelay): Promise<{ pwa: Peer; code: string }> {
  const pwa = makePeer(1, relay);
  expect((await pwa.engine.turnOn()).ok).toBe(true);
  return { pwa, code: pwa.engine.showCode()!.code };
}

const page = (over: Record<string, unknown> = {}) => ({
  url: 'https://www.Example.com/post?utm_source=x&id=7#top',
  title: 'A long read',
  author: 'Ana' as string | null,
  words: 2380 as number | null,
  at: '2026-09-28T09:00:00.000Z',
  readOn: '2026-09-28',
  ...over,
});
const gets = (r: FakeRelay) => r.log.filter((x) => x.method === 'GET' && x.path.includes('/batches'));
const posts = (r: FakeRelay) => r.log.filter((x) => x.method === 'POST');

describe('capture peer: pair', () => {
  it('a bad code gives format or checksum', async () => {
    const relay = fakeRelay();
    const { peer } = setup(relay);
    expect(await peer.pair(ORIGIN, 'nope')).toEqual({ ok: false, error: { kind: 'format' } });
    const { code } = await host(relay);
    const typo = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');
    expect(await peer.pair(ORIGIN, typo)).toEqual({ ok: false, error: { kind: 'checksum' } });
    expect((await peer.status()).paired).toBe(false);
  });

  it('an unknown space gives notFound', async () => {
    const relay = fakeRelay();
    const { peer } = setup(relay);
    const unknown = formatSyncCode(Uint8Array.from({ length: 32 }, (_, i) => 200 - i));
    expect(await peer.pair(ORIGIN, unknown)).toEqual({ ok: false, error: { kind: 'notFound' } });
  });

  it('success stores appOrigin and syncKey', async () => {
    const relay = fakeRelay();
    const { peer, store } = setup(relay);
    const { code } = await host(relay);
    expect((await peer.pair(ORIGIN, code)).ok).toBe(true);
    expect(await store.get('appOrigin')).toBe(ORIGIN);
    expect(typeof (await store.get('syncKey'))).toBe('string');
    expect(await peer.status()).toMatchObject({ paired: true, waiting: 0 });
  });
});

describe('capture peer: capture', () => {
  it('stores the ops and pushes them; a PWA peer pulls and lists the article', async () => {
    const relay = fakeRelay();
    const { pwa, code } = await host(relay);
    const { peer } = setup(relay);
    await peer.pair(ORIGIN, code);
    const r = await peer.capture(page());
    expect(r.ok).toBe(true);
    // capture() only stores: nothing has been sent yet.
    expect(posts(relay)).toHaveLength(0);
    expect((await peer.status()).waiting).toBe(1);
    expect((await peer.flush()).sent).toBe(1);
    expect((await peer.status()).waiting).toBe(0);
    await pwa.engine.run('manual');
    const list = pwa.db.articles();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: 'A long read',
      author: 'Ana',
      url: 'https://www.example.com/post?id=7',
      domain: 'example.com',
      wordCount: 2380,
      readOn: '2026-09-28',
    });
  });

  it('is push-only: the request log has no GET /batches (FR-012)', async () => {
    const relay = fakeRelay();
    const { code } = await host(relay);
    const { peer } = setup(relay);
    relay.log.length = 0;
    await peer.pair(ORIGIN, code);
    await peer.capture(page());
    await peer.capture(page({ url: 'https://example.org/b', at: '2026-09-28T10:00:00.000Z' }));
    await peer.flush();
    expect(posts(relay).length).toBeGreaterThan(0);
    expect(gets(relay)).toEqual([]);
  });

  it('not paired and invalid input are refused', async () => {
    const relay = fakeRelay();
    const { peer } = setup(relay);
    expect(await peer.capture(page())).toEqual({ ok: false, error: 'notPaired' });
    const { code } = await host(relay);
    await peer.pair(ORIGIN, code);
    expect(await peer.capture(page({ url: 'ftp://x.test/a' }))).toEqual({ ok: false, error: 'invalid' });
  });

  it('offline: a capture waits, status counts it, a later flush sends it', async () => {
    const relay = fakeRelay();
    const { pwa, code } = await host(relay);
    const { peer, state } = setup(relay);
    await peer.pair(ORIGIN, code);
    state.online = false;
    expect((await peer.capture(page())).ok).toBe(true);
    expect((await peer.status()).waiting).toBe(1);
    expect((await peer.flush()).problem).toBe('offline');
    expect((await peer.status()).problem).toBe('offline');
    expect((await peer.status()).waiting).toBe(1);
    state.online = true;
    const f = await peer.flush();
    expect(f.sent).toBe(1);
    expect(f.problem).toBeNull();
    const s = await peer.status();
    expect(s.waiting).toBe(0);
    expect(s.lastSentAt).not.toBeNull();
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
  });

  it('crash recovery: a crash after the relay stored a batch resends the same batchId', async () => {
    const relay = fakeRelay();
    const { pwa, code } = await host(relay);
    const { peer } = setup(relay);
    await peer.pair(ORIGIN, code);
    const ids: string[] = [];
    relay.before = (req) => {
      if (req.method === 'POST' && req.body) ids.push((JSON.parse(req.body) as { batchId: string }).batchId);
    };
    let crashed = false;
    relay.after = (req) => {
      if (req.method === 'POST' && !crashed) {
        crashed = true;
        throw new TypeError('lost response');
      }
    };
    await peer.capture(page());
    expect((await peer.flush()).sent).toBe(0); // the response was lost
    expect((await peer.status()).waiting).toBe(1);
    const f = await peer.flush();
    expect(f.sent).toBe(1);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
  });

  it('duplicates: a second capture of the same URL returns duplicateOf; force logs it again', async () => {
    const relay = fakeRelay();
    const { pwa, code } = await host(relay);
    const { peer } = setup(relay);
    await peer.pair(ORIGIN, code);
    const first = await peer.capture(page());
    expect(first).toMatchObject({ ok: true });
    await peer.flush();
    const again = await peer.capture(page({ url: 'https://www.example.com/post?id=7&ref=hn', at: '2026-09-29T09:00:00.000Z', readOn: '2026-09-29' }));
    expect(again).toMatchObject({ ok: true, value: { duplicateOf: { readOn: '2026-09-28' } } });
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);

    const forced = await peer.capture(page({ at: '2026-09-29T09:00:00.000Z', readOn: '2026-09-29', force: true }));
    expect(forced.ok && forced.value.duplicateOf).toBeFalsy();
    await peer.flush();
    await pwa.engine.run('manual');
    expect(pwa.db.articles().map((a) => a.readOn).sort()).toEqual(['2026-09-28', '2026-09-29']);
  });

  it('idempotency: the same url and at give the same itemId, and the second is a no-op', async () => {
    const relay = fakeRelay();
    const { code } = await host(relay);
    const { peer } = setup(relay);
    await peer.pair(ORIGIN, code);
    const a = await peer.capture(page());
    const b = await peer.capture(page());
    expect(a.ok && b.ok && a.value.itemId === b.value.itemId).toBe(true);
    expect(a.ok && a.value.itemId).toBe(await uuidFromHash('readerlog-capture-v1|https://www.example.com/post?id=7|2026-09-28T09:00:00.000Z'));
    expect(b.ok && b.value.duplicateOf).toBeUndefined();
    await peer.flush();
    expect(posts(relay)).toHaveLength(1);
  });
});

describe('capture peer: undo and unpair', () => {
  it('undo emits RemoveArticle and the PWA peer sees the article removed', async () => {
    const relay = fakeRelay();
    const { pwa, code } = await host(relay);
    const { peer } = setup(relay);
    await peer.pair(ORIGIN, code);
    const r = await peer.capture(page());
    if (!r.ok) throw new Error('capture');
    await peer.flush();
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
    await peer.undo(r.value.itemId);
    expect((await peer.status()).waiting).toBe(1);
    await peer.flush();
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(0);
    // After an undo the same URL is no longer a duplicate.
    const again = await peer.capture(page({ at: '2026-09-29T09:00:00.000Z', readOn: '2026-09-29' }));
    expect(again.ok && again.value.duplicateOf).toBeUndefined();
  });

  it('unpair forgets the code and the waiting captures', async () => {
    const relay = fakeRelay();
    const { code } = await host(relay);
    const { peer, state, store } = setup(relay);
    await peer.pair(ORIGIN, code);
    state.online = false;
    await peer.capture(page());
    await peer.unpair();
    expect(await peer.status()).toMatchObject({ paired: false, waiting: 0 });
    expect(await store.get('syncKey')).toBeFalsy();
  });
});
