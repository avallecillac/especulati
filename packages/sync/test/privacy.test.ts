// Privacy audit (SC-005, FR-004): the relay holds only ciphertext, and what the ciphertext holds is
// only the three synced tables. Distinctive seed values make a substring scan free of false positives.
import { describe, expect, it } from 'vitest';
import { parseSyncCode } from '../src/code.ts';
import { deriveKeys } from '../src/keys.ts';
import { open } from '../src/envelope.ts';
import { fakeRelay, makePeer, uuid, type Peer } from './harness.ts';

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
    const keys = await deriveKeys(k.value);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    expect(batches.length).toBeGreaterThan(1);

    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId);
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
