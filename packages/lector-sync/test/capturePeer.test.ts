import { describe, expect, it } from 'vitest';
import { formatSyncCode, uuidFromHash } from '@especulati/sync';
import { createCapturePeer, type CaptureStore } from '../src/capturePeer.ts';
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

describe('capture peer: highlights (007)', () => {
  const at = '2026-09-28T09:05:00.000Z';
  async function paired(relay: FakeRelay) {
    const { code, pwa } = await host(relay);
    const ctx = setup(relay);
    await ctx.peer.pair(ORIGIN, code);
    const cap = await ctx.peer.capture(page());
    if (!cap.ok) throw new Error('capture');
    return { ...ctx, pwa, itemId: cap.value.itemId };
  }
  const hl = (itemId: string, over: Record<string, unknown> = {}) => ({ itemId, quote: 'A passage worth keeping.', at, localDate: '2026-09-28', ...over });
  const pendingOps = async (store: CaptureStore) => (await store.get<{ op: string; tbl: string; fields: Record<string, unknown> }[]>('pending')) ?? [];

  it('stamps AddHighlight, EditHighlightNote and RemoveHighlight with the derived id', async () => {
    const relay = fakeRelay();
    const { peer, store, itemId } = await paired(relay);
    const r = await peer.highlight(hl(itemId, { quote: '  A passage\r\n worth   keeping. ' }));
    expect(r).toEqual({ ok: true, value: { highlightId: await uuidFromHash('readerlog-highlight-v1|https://www.example.com/post?id=7|' + at) } });
    const id = r.ok ? r.value.highlightId : '';
    expect((await peer.editNote(id, 'a note')).ok).toBe(true);
    await peer.undoHighlight(id);
    const ops = (await pendingOps(store)).filter((o) => o.tbl === 'highlights');
    expect(ops).toHaveLength(3);
    expect(ops[0]!.fields).toMatchObject({ item_id: itemId, quote: 'A passage\nworth keeping.', local_date: '2026-09-28' });
    expect(ops[1]!.fields).toEqual({ note: 'a note' });
    expect(Object.keys(ops[2]!.fields)).toEqual(['deleted_at']);
    // a second undo adds nothing
    await peer.undoHighlight(id);
    expect((await pendingOps(store)).filter((o) => o.tbl === 'highlights')).toHaveLength(3);
  });

  it('rejects notPaired, tooLong, empty quote, unknown article and edits of unknown highlights', async () => {
    const relay = fakeRelay();
    const lone = setup(relay);
    expect(await lone.peer.highlight(hl('11111111-1111-4111-8111-111111111111'))).toEqual({ ok: false, error: 'notPaired' });
    const { peer, itemId } = await paired(relay);
    expect(await peer.highlight(hl(itemId, { quote: 'x'.repeat(5001) }))).toEqual({ ok: false, error: 'tooLong' });
    expect(await peer.highlight(hl(itemId, { quote: '   \n ' }))).toEqual({ ok: false, error: 'invalid' });
    expect(await peer.highlight(hl('22222222-2222-4222-8222-222222222222'))).toEqual({ ok: false, error: 'invalid' });
    const r = await peer.highlight(hl(itemId));
    if (!r.ok) throw new Error('highlight');
    expect(await peer.editNote(r.value.highlightId, 'n'.repeat(5001))).toEqual({ ok: false, error: 'tooLong' });
    expect(await peer.editNote('33333333-3333-4333-8333-333333333333', 'n')).toEqual({ ok: false, error: 'invalid' });
  });

  it('flushing [AddArticle, AddHighlight] posts two batches, in order, and never GETs', async () => {
    const relay = fakeRelay();
    const { pwa, peer, itemId } = await paired(relay);
    relay.log.length = 0;
    expect((await peer.highlight(hl(itemId, { note: 'a note' }))).ok).toBe(true);
    expect((await peer.status()).waiting).toBe(2);
    expect((await peer.flush()).sent).toBe(2);
    expect(posts(relay)).toHaveLength(2);
    expect(gets(relay)).toEqual([]);
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
    expect(pwa.db.highlights(itemId)).toMatchObject([{ quote: 'A passage worth keeping.', note: 'a note' }]);
  });

  it('keeps only the newest 2,000 highlights in storage', async () => {
    const relay = fakeRelay();
    const { peer, store, itemId } = await paired(relay);
    for (let i = 0; i < 2002; i++) {
      const r = await peer.highlight(hl(itemId, { at: new Date(Date.UTC(2026, 8, 28, 10) + i * 1000).toISOString() }));
      expect(r.ok).toBe(true);
      if (i % 200 === 199) await peer.flush();
    }
    expect(Object.keys((await store.get<Record<string, unknown>>('highlights')) ?? {})).toHaveLength(2000);
  }, 60000);
});

describe('capture peer: save for later and tags (008)', () => {
  type Op = { op: string; tbl: string; row: string; fields: Record<string, unknown> };
  const pendingOps = async (store: CaptureStore) => (await store.get<Op[]>('pending')) ?? [];
  const saveInput = (over: Record<string, unknown> = {}) => ({
    url: 'https://www.Example.com/post?utm_source=x&id=7#top',
    title: 'A long read',
    author: 'Ana' as string | null,
    words: 2380 as number | null,
    at: '2026-09-28T09:00:00.000Z',
    ...over,
  });
  async function paired(relay: FakeRelay) {
    const { code, pwa } = await host(relay);
    const ctx = setup(relay);
    await ctx.peer.pair(ORIGIN, code);
    return { ...ctx, pwa };
  }
  const tagId = (name: string) => uuidFromHash(`readerlog-tag-v1|${name}`);

  it('save() stamps AddArticle with read_on: null explicitly and records captured.saved', async () => {
    const { peer, store } = await paired(fakeRelay());
    const r = await peer.save(saveInput());
    if (!r.ok) throw new Error('save');
    const ops = await pendingOps(store);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.tbl).toBe('items');
    expect(Object.prototype.hasOwnProperty.call(ops[0]!.fields, 'read_on')).toBe(true);
    expect(ops[0]!.fields['read_on']).toBeNull();
    const captured = (await store.get<Record<string, { saved?: boolean; itemId: string }>>('captured'))!;
    expect(Object.values(captured)).toMatchObject([{ saved: true, itemId: r.value.itemId }]);
  });

  it('save() twice for the same url says alreadySaved; not paired is refused; a bad url is invalid', async () => {
    const relay = fakeRelay();
    const { peer } = await paired(relay);
    const a = await peer.save(saveInput());
    const b = await peer.save(saveInput({ at: '2026-09-28T10:00:00.000Z' }));
    if (!a.ok || !b.ok) throw new Error('save');
    expect(b.value).toEqual({ itemId: a.value.itemId, alreadySaved: true });
    expect(await peer.save(saveInput({ url: 'nope' }))).toEqual({ ok: false, error: 'invalid' });
    const lone = setup(relay);
    expect(await lone.peer.save(saveInput())).toEqual({ ok: false, error: 'notPaired' });
  });

  it('capture() on a saved entry stamps MarkArticleRead with the full row, and the PWA shows one read article', async () => {
    const relay = fakeRelay();
    const { peer, store, pwa } = await paired(relay);
    const s = await peer.save(saveInput());
    if (!s.ok) throw new Error('save');
    const c = await peer.capture(page({ title: 'Other title' }));
    expect(c).toEqual({ ok: true, value: { itemId: s.value.itemId } });
    const ops = await pendingOps(store);
    expect(ops).toHaveLength(2);
    expect(ops[1]!.row).toBe(s.value.itemId);
    expect(ops[1]!.fields).toMatchObject({
      type: 'article',
      title: 'A long read',
      url: 'https://www.example.com/post?id=7',
      domain: 'example.com',
      author: 'Ana',
      word_count: 2380,
      metadata_status: 'ok',
      read_on: '2026-09-28',
    });
    expect(typeof ops[1]!.fields['created_at']).toBe('string');
    expect(await peer.flush()).toMatchObject({ problem: null });
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
    // A second Log as read is a duplicate of the now-read entry.
    expect(await peer.capture(page())).toMatchObject({ ok: true, value: { duplicateOf: { readOn: '2026-09-28' } } });
  });

  it('highlight() on a saved entry stamps MarkArticleRead (full row) before AddHighlight', async () => {
    const { peer, store } = await paired(fakeRelay());
    const s = await peer.save(saveInput());
    if (!s.ok) throw new Error('save');
    const h = await peer.highlight({ itemId: s.value.itemId, quote: 'A passage.', at: '2026-09-28T09:05:00.000Z', localDate: '2026-09-28' });
    expect(h.ok).toBe(true);
    const ops = await pendingOps(store);
    expect(ops.map((o) => o.tbl)).toEqual(['items', 'items', 'highlights']);
    expect(ops[1]!.fields).toMatchObject({ title: 'A long read', read_on: '2026-09-28', metadata_status: 'ok' });
    // Already read now: a second highlight adds no further mark-read.
    await peer.highlight({ itemId: s.value.itemId, quote: 'Another.', at: '2026-09-28T09:06:00.000Z', localDate: '2026-09-28' });
    expect((await pendingOps(store)).map((o) => o.tbl)).toEqual(['items', 'items', 'highlights', 'highlights']);
  });

  it('tag() stamps TagArticle with ids derived in the shell; invalid names are dropped; the limit holds', async () => {
    const { peer, store } = await paired(fakeRelay());
    const s = await peer.save(saveInput());
    if (!s.ok) throw new Error('save');
    const r = await peer.tag(s.value.itemId, ['AI', ' design ', 'ai', '', 'x'.repeat(41)]);
    expect(r).toEqual({ ok: true, value: { added: 2, dropped: 3 } });
    const ops = (await pendingOps(store)).filter((o) => o.tbl === 'tags' || o.tbl === 'item_tags');
    const aiId = await tagId('ai');
    const designId = await tagId('design');
    expect(ops.filter((o) => o.tbl === 'tags').map((o) => o.row)).toEqual([aiId, designId]);
    expect(ops.filter((o) => o.tbl === 'tags').map((o) => o.fields['name'])).toEqual(['AI', 'design']);
    expect(ops.find((o) => o.tbl === 'item_tags')!.row).toBe(await uuidFromHash(`readerlog-item-tag-v1|${s.value.itemId}|${aiId}`));
    // Tagging again with the same name adds nothing.
    expect(await peer.tag(s.value.itemId, ['ai'])).toEqual({ ok: true, value: { added: 0, dropped: 0 } });
    // 18 more reach 20; one more is refused (dropped).
    const more = Array.from({ length: 19 }, (_, i) => `t${i}`);
    expect(await peer.tag(s.value.itemId, more)).toEqual({ ok: true, value: { added: 18, dropped: 1 } });
    expect(await peer.tag('00000000-0000-4000-8000-000000000000', ['a'])).toEqual({ ok: false, error: 'invalid' });
  });

  it('flushes are single-tier per tierOf: s, then t, then base; the PWA sees the tags', async () => {
    const relay = fakeRelay();
    const { peer, store, pwa } = await paired(relay);
    const s = await peer.save(saveInput());
    if (!s.ok) throw new Error('save');
    await peer.tag(s.value.itemId, ['ai', 'design']);
    await peer.capture(page());
    expect((await pendingOps(store)).length).toBe(1 + 4 + 1);
    relay.log.length = 0;
    expect((await peer.flush()).sent).toBe(6);
    expect(posts(relay)).toHaveLength(3);
    expect(gets(relay)).toEqual([]);
    await pwa.engine.run('manual');
    expect(pwa.db.articles()).toHaveLength(1);
  });
});
