import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { LectorDb, type DispatchEnv } from '@especulati/lector-db';
import type { Instant } from '@especulati/lector-core';
import { findReconcilePair, highlightCopyId, itemTagId, reconcileAll } from './reconcile.ts';
import { uuidFromHash } from './ids.ts';

const sqlite3 = await sqlite3InitModule();
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function open() {
  let wall = Date.UTC(2026, 8, 27, 12, 0, 0);
  let op = 0;
  const env: DispatchEnv = { now: new Date(wall).toISOString() as Instant, wallMs: () => wall, newOpId: () => uuid(0x10000 + ++op) };
  const db = new LectorDb(new sqlite3.oo1.DB(':memory:'));
  db.migrate();
  db.ensureDeviceId(uuid(0xd00d));
  const tick = () => {
    wall += 1000;
    env.now = new Date(wall).toISOString() as Instant;
    return env;
  };
  return { db, env: () => tick() };
}
type T = ReturnType<typeof open>;

function article(t: T, n: number, url: string, readOn?: string) {
  const r = t.db.dispatch({ kind: 'AddArticle', itemId: uuid(n), url, title: `Article ${n}`, author: null, wordCount: 100, ...(readOn ? { readOn } : {}), detailsStatus: 'complete' }, t.env());
  expect(r.ok).toBe(true);
}
async function tag(t: T, item: number, name: string) {
  const tagId = (await t.db.resolveTagId(name, uuidFromHash))!;
  expect(t.db.dispatch({ kind: 'TagArticle', itemId: uuid(item), tagId, itemTagId: await itemTagId(uuid(item), tagId), name }, t.env()).ok).toBe(true);
}
const URL_ = 'https://www.example.com/read/essay';
const live = (t: T) => t.db.raw.selectArrays("SELECT id, read_on FROM items WHERE type = 'article' AND deleted_at IS NULL ORDER BY id");

describe('reconcileAll (008 R4)', () => {
  it('merges a later read copy into the saved article: read date, highlight and tag (SC-002)', async () => {
    const t = open();
    article(t, 1, URL_); // A: saved, then tagged
    await tag(t, 1, 'ai');
    article(t, 2, URL_, '2026-09-27'); // B: logged later as read, with a highlight
    expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(20), itemId: uuid(2), quote: 'A passage.', note: null, localDate: '2026-09-27' }, t.env()).ok).toBe(true);

    expect(findReconcilePair(t.db)).toEqual({ survivorId: uuid(1), duplicateId: uuid(2) });
    expect(await reconcileAll(t.db, t.env)).toBe(1);

    expect(live(t)).toEqual([[uuid(1), '2026-09-27']]);
    const hs = t.db.highlights(uuid(1));
    expect(hs).toHaveLength(1);
    expect(hs[0]!.quote).toBe('A passage.');
    expect(hs[0]!.id).toBe(await highlightCopyId(uuid(1), { quote: 'A passage.', note: null, page: null, createdAt: hs[0]!.createdAt, localDate: '2026-09-27' }));
    expect(t.db.tagsFor(uuid(1)).map((x) => x.name)).toEqual(['ai']);
    expect(t.db.raw.selectValue('SELECT merged_into FROM items WHERE id = ?', [uuid(2)])).toBe(uuid(1));
  });

  it('carries the duplicate\'s own tags to the survivor with derived assignment ids', async () => {
    const t = open();
    article(t, 1, URL_);
    article(t, 2, URL_, '2026-09-27');
    await tag(t, 2, 'ai');
    expect(await reconcileAll(t.db, t.env)).toBe(1);
    const tagId = (await t.db.resolveTagId('ai', uuidFromHash))!;
    expect(t.db.tagsFor(uuid(1)).map((x) => [x.name, x.itemTagId])).toEqual([['ai', await itemTagId(uuid(1), tagId)]]);
    expect(t.db.tagsFor(uuid(2))).toEqual([]);
  });

  it('is idempotent: a second run finds nothing', async () => {
    const t = open();
    article(t, 1, URL_);
    article(t, 2, URL_, '2026-09-27');
    expect(await reconcileAll(t.db, t.env)).toBe(1);
    const changes = t.db.raw.selectValue('SELECT count(*) FROM change_log');
    expect(findReconcilePair(t.db)).toBeNull();
    expect(await reconcileAll(t.db, t.env)).toBe(0);
    expect(t.db.raw.selectValue('SELECT count(*) FROM change_log')).toBe(changes);
  });

  it('merges two saved copies into the earliest', async () => {
    const t = open();
    article(t, 5, URL_);
    article(t, 3, URL_); // created later than 5, though its id sorts first
    expect(await reconcileAll(t.db, t.env)).toBe(1);
    expect(live(t)).toEqual([[uuid(5), null]]);
  });

  it('leaves a re-read alone: a read article created before the save, or two read articles', async () => {
    const t = open();
    article(t, 1, URL_, '2026-09-01');
    article(t, 2, URL_); // saved again after it was read
    article(t, 3, 'https://www.example.com/other', '2026-09-02');
    article(t, 4, 'https://www.example.com/other', '2026-09-03');
    expect(findReconcilePair(t.db)).toBeNull();
    expect(await reconcileAll(t.db, t.env)).toBe(0);
    expect(live(t)).toHaveLength(4);
  });

  it('absorbs a saved copy and then a later read copy of the same URL', async () => {
    const t = open();
    article(t, 1, URL_);
    article(t, 2, URL_);
    article(t, 3, URL_, '2026-09-27');
    expect(await reconcileAll(t.db, t.env)).toBe(2);
    expect(live(t)).toEqual([[uuid(1), '2026-09-27']]);
  });
});
