// Privacy audit (SC-005, FR-004): the relay holds only ciphertext, and what the ciphertext holds is
// only the three synced tables. Distinctive seed values make a substring scan free of false positives.
import { describe, expect, it } from 'vitest';
import { deriveKeys, open, parseSyncCode } from '@especulati/sync';
import { lectorSyncApp } from '../src/index.ts';
import { createCapturePeer, type CaptureStore } from '../src/capturePeer.ts';
import { fakeRelay, makePeer, prng, randomBytes, uuid, type Peer } from './harness.ts';

const TITLE = 'Zanzibar Quokka Chronicle';
const AUTHOR = 'Ophelia Wurtzelbacher';
const ISBN = '9780441172719';
const PAGE = 7351;
const DATES = ['2031-03-14', '2031-04-02', '2031-05-19'];
const GOOGLE_KEY = 'AIzaSyDISTINCTIVE-google-key-0042';
const COVER_MARK = 'COVER-BYTES-MARKER-5150';
const SYNC_KEY_MARK = 'SYNC-KEY-MARKER-8675309';

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** Every way `needle` can appear in base64 / base64url text, whatever its byte alignment. */
function encodings(needle: string): string[] {
  const out = [needle];
  for (let pad = 0; pad < 3; pad++) {
    const full = b64(utf8('x'.repeat(pad) + needle));
    // Drop the chars that mix in the padding bytes, and the last two that depend on what follows.
    const stable = full.slice(Math.ceil((pad * 4) / 3), -2).replace(/=+$/, '');
    if (stable.length >= 8) out.push(stable, stable.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return out;
}

let n = 0;
function addBook(p: Peer, title: string, extra: { author?: string; isbn?: string; totalPages?: number } = {}): string {
  p.tick();
  const itemId = uuid(0x700000 + ++n);
  const r = p.db.dispatch({ kind: 'AddBook', itemId, title, startNow: true, startEventId: uuid(0x730000 + n), localDate: DATES[0]!, ...extra }, p.env);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return itemId;
}

describe('privacy audit (SC-005)', () => {
  it('the relay stores no plaintext, and pushed batches carry only the synced tables', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    a.db.setMeta('google_books_api_key', GOOGLE_KEY);
    a.db.setMeta('device_note', SYNC_KEY_MARK);
    expect((await a.engine.turnOn()).ok).toBe(true);

    const book = addBook(a, TITLE, { author: AUTHOR, isbn: ISBN, totalPages: 9000 });
    a.db.putCover(book, utf8(COVER_MARK), 100, 150, '2031-03-14T00:00:00.000Z');
    a.tick();
    expect(a.db.dispatch({ kind: 'LogEvent', itemId: book, eventId: uuid(0x710001), type: 'progress', page: PAGE, localDate: DATES[1]! }, a.env).ok).toBe(true);
    const other = addBook(a, 'Second Distinct Volume');
    a.tick();
    expect(a.db.dispatch({ kind: 'DismissDuplicate', dismissalId: uuid(0x720001), itemA: book, itemB: other }, a.env).ok).toBe(true);
    await a.engine.run('write');

    const b = makePeer(2, relay);
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    addBook(b, 'Peer Two Volume', { author: 'Some Author' });
    b.tick();
    expect(b.db.dispatch({ kind: 'LogEvent', itemId: book, eventId: uuid(0x710002), type: 'finished', localDate: DATES[2]! }, b.env).ok).toBe(true);
    await b.engine.run('write');
    await a.engine.run('visible');

    // The local seed is really there, so the assertions below mean something.
    expect(a.db.raw.selectValue('SELECT count(*) FROM covers')).toBe(1);
    expect(a.db.raw.selectValue("SELECT count(*) FROM meta WHERE key = 'google_books_api_key'")).toBe(1);

    const k = parseSyncCode(a.engine.showCode()!.code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, lectorSyncApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    expect(batches.length).toBeGreaterThan(1);

    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId, lectorSyncApp.aadPrefix);
      expect(r.ok).toBe(true);
      if (r.ok) plains.push(r.value);
    }
    const ops = plains.flatMap((p) => p.ops);
    expect(ops.length).toBeGreaterThan(5);

    // 1. Nothing identifying is visible in any relay row, in the clear or base64 / base64url.
    const dump = relay.store.dumpAll();
    expect(dump.length).toBeGreaterThan(0);
    const needles = [
      TITLE, AUTHOR, ISBN, `"page":${PAGE}`, String(PAGE), ...DATES, GOOGLE_KEY, COVER_MARK, SYNC_KEY_MARK,
      'title', 'author', 'isbn', 'local_date', 'op_id', 'device',
      a.device, b.device,
      ...ops.flatMap((o) => [o.op, o.row]),
    ];
    for (const needle of needles) {
      for (const form of encodings(needle)) {
        if (form.length < 4) continue;
        expect(dump.includes(form), `relay dump must not contain ${JSON.stringify(needle)} as ${JSON.stringify(form)}`).toBe(false);
      }
    }
    expect(new Set(ops.map((o) => o.op)).size).toBeGreaterThan(5); // the ids scanned above are real

    // 2. The decrypted batches hold only the three synced tables and none of the local-only data.
    const tables = new Set(ops.map((o) => o.tbl));
    for (const t of tables) expect(['items', 'reading_events', 'duplicate_dismissals']).toContain(t);
    expect(tables).toEqual(new Set(['items', 'reading_events', 'duplicate_dismissals']));
    const text = JSON.stringify(plains);
    for (const banned of ['covers', '"tbl":"meta"', 'google_books_api_key', 'sync_key', 'device_note', GOOGLE_KEY, COVER_MARK, SYNC_KEY_MARK, 'AIza']) {
      expect(text.includes(banned), `decrypted batches must not contain ${banned}`).toBe(false);
    }
    // Sanity: what should be synced is there.
    expect(text).toContain(TITLE);
    expect(text).toContain(String(PAGE));
  });
});

describe('privacy audit: article capture (SC-004)', () => {
  it('a capture-peer article never appears in relay rows, and its batches hold only the FR-001 fields', async () => {
    const A_TITLE = 'Zanzibar Quokka Essay';
    const A_URL = 'https://quokka.example/essay-7351';
    const A_AUTHOR = 'Ottoline Brackwater';
    const A_WORDS = 4321;
    const relay = fakeRelay();
    const host = makePeer(1, relay);
    expect((await host.engine.turnOn()).ok).toBe(true);
    const code = host.engine.showCode()!.code;

    const data = new Map<string, unknown>();
    const store: CaptureStore = {
      get<T>(k: string) {
        return Promise.resolve(data.has(k) ? (structuredClone(data.get(k)) as T) : undefined);
      },
      set(patch) {
        for (const [k, v] of Object.entries(patch)) data.set(k, structuredClone(v));
        return Promise.resolve();
      },
    };
    const wall = Date.UTC(2026, 8, 28, 9, 0, 0);
    const peer = createCapturePeer(store, { fetch: relay.fetch, now: () => wall, random: randomBytes(prng(77)), online: () => true });
    expect((await peer.pair('https://readerlog.test', code)).ok).toBe(true);
    const cap = await peer.capture({ url: A_URL, title: A_TITLE, author: A_AUTHOR, words: A_WORDS, at: '2026-09-28T09:00:00.000Z', readOn: '2026-09-28' });
    expect(cap.ok).toBe(true);
    expect((await peer.flush()).sent).toBe(1);

    const k = parseSyncCode(code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, lectorSyncApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    expect(batches.length).toBeGreaterThan(0);
    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId, lectorSyncApp.aadPrefix);
      expect(r.ok).toBe(true);
      if (r.ok) plains.push(r.value);
    }
    const ops = plains.flatMap((p) => p.ops);
    expect(ops.length).toBeGreaterThan(0);

    // 1. Nothing about the article is visible in any relay row, in the clear or base64 / base64url.
    const dump = relay.store.dumpAll();
    expect(dump.length).toBeGreaterThan(0);
    for (const needle of [A_TITLE, A_URL, 'quokka.example', A_AUTHOR, `"word_count":${A_WORDS}`]) {
      for (const form of encodings(needle)) {
        if (form.length < 4) continue;
        expect(dump.includes(form), `relay dump must not contain ${JSON.stringify(needle)} as ${JSON.stringify(form)}`).toBe(false);
      }
    }

    // 2. The decrypted batches hold only `items` ops with the FR-001 fields, and no text body.
    const allowed = new Set(['type', 'title', 'author', 'url', 'domain', 'word_count', 'read_on', 'metadata_status', 'created_at', 'deleted_at']);
    for (const o of ops) {
      expect(o.tbl).toBe('items');
      for (const f of Object.keys(o.fields)) expect(allowed.has(f), `unexpected field ${f}`).toBe(true);
    }
    const text = JSON.stringify(plains);
    expect(text).toContain(A_TITLE); // sanity: the article really is in the batch
    expect(text).toContain('"word_count":4321');
  });
});


describe('privacy audit: highlights and notes (007)', () => {
  it('a quote and a note never appear in relay rows, raw or base64, but are in the decrypted batch', async () => {
    const QUOTE = 'The vermilion lighthouse hummed Welsh lullabies at dusk';
    const NOTE = 'Remember to ask Bartholomew about the lullabies';
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    expect((await a.engine.turnOn()).ok).toBe(true);
    a.tick();
    const item = uuid(0x740001);
    expect(a.db.dispatch({ kind: 'AddArticle', itemId: item, url: 'https://lighthouse.example/essay', title: 'Plain Title', author: null, wordCount: 1200, readOn: '2031-03-14', detailsStatus: 'complete' }, a.env).ok).toBe(true);
    a.tick();
    expect(a.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x740002), itemId: item, quote: QUOTE, note: NOTE, localDate: '2031-03-14' }, a.env).ok).toBe(true);
    await a.engine.run('write');
    expect(a.db.pendingCount()).toBe(0);

    const k = parseSyncCode(a.engine.showCode()!.code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, lectorSyncApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId, lectorSyncApp.aadPrefix);
      expect(r.ok).toBe(true);
      if (r.ok) plains.push(r.value);
    }
    const dump = relay.store.dumpAll();
    expect(dump.length).toBeGreaterThan(0);
    for (const needle of [QUOTE, NOTE, 'vermilion lighthouse', 'Bartholomew', '"quote"', '"note"']) {
      for (const form of encodings(needle)) {
        if (form.length < 4) continue;
        expect(dump.includes(form), `relay dump must not contain ${JSON.stringify(needle)} as ${JSON.stringify(form)}`).toBe(false);
      }
    }
    // Sanity: the text really is in the encrypted batch, in its own single-tier batch.
    const text = JSON.stringify(plains);
    expect(text).toContain(QUOTE);
    expect(text).toContain(NOTE);
    expect(plains.filter((p) => p.ops.some((o) => o.tbl === 'highlights')).every((p) => p.ops.every((o) => o.tbl === 'highlights'))).toBe(true);
  });
});

describe('privacy audit: tags and saved articles (008)', () => {
  it('a tag name never appears in relay rows, raw or base64, but is in its own decrypted tier batch', async () => {
    const TAG = 'Marsupial Reading Backlog';
    const SAVED_TITLE = 'Saved Zanzibar Dispatch';
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    expect((await a.engine.turnOn()).ok).toBe(true);
    const item = uuid(0x750001);
    const tagId = uuid(0x750002);
    a.tick();
    expect(a.db.dispatch({ kind: 'AddArticle', itemId: item, url: 'https://saved.example/dispatch', title: SAVED_TITLE, author: null, wordCount: 900, detailsStatus: 'complete' }, a.env).ok).toBe(true);
    a.tick();
    expect(a.db.dispatch({ kind: 'TagArticle', itemId: item, tagId, itemTagId: uuid(0x750003), name: TAG }, a.env).ok).toBe(true);
    await a.engine.run('write');
    expect(a.db.pendingCount()).toBe(0);

    const k = parseSyncCode(a.engine.showCode()!.code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, lectorSyncApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId, lectorSyncApp.aadPrefix);
      expect(r.ok).toBe(true);
      if (r.ok) plains.push(r.value);
    }
    const dump = relay.store.dumpAll();
    expect(dump.length).toBeGreaterThan(0);
    for (const needle of [TAG, 'Marsupial', 'Reading Backlog', 'marsupial reading backlog', SAVED_TITLE, '"name_key"', '"item_tags"']) {
      for (const form of encodings(needle)) {
        if (form.length < 4) continue;
        expect(dump.includes(form), `relay dump must not contain ${JSON.stringify(needle)} as ${JSON.stringify(form)}`).toBe(false);
      }
    }
    // Sanity: the name is in the encrypted batch, and tags travel apart from saved-article items ops.
    expect(JSON.stringify(plains)).toContain(TAG);
    const tiers = plains.map((p) => new Set(p.ops.map((o) => o.tbl)));
    expect(tiers.some((t) => t.has('tags') && t.has('item_tags') && t.size === 2)).toBe(true);
    expect(tiers.some((t) => t.has('items') && t.size === 1)).toBe(true);
  });
});
