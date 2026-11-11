import { describe, expect, it } from 'vitest';
import { openTestDb, TODAY, uuid, type TestDb } from './helpers.ts';

function addArticle(t: TestDb, n: number) {
  t.tick();
  const r = t.db.dispatch({ kind: 'AddArticle', itemId: uuid(n), url: `https://www.example.com/a${n}`, title: `Article ${n}`, author: null, wordCount: 476, readOn: '2026-09-10', detailsStatus: 'complete' }, t.env);
  expect(r).toMatchObject({ ok: true });
}
function addHighlight(t: TestDb, n: number, itemId: string, p: { quote?: string | null; note?: string | null } = { quote: `Quote ${n}` }) {
  t.tick();
  const r = t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(n), itemId, localDate: '2026-09-11', ...p }, t.env);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
}

describe('highlights read model', () => {
  it('highlights(itemId) is ordered by created_at, id; live rows only', () => {
    const t = openTestDb();
    addArticle(t, 1);
    addArticle(t, 2);
    addHighlight(t, 0x30, uuid(1), { quote: 'later id, first' });
    addHighlight(t, 0x20, uuid(1), { quote: 'earlier id, second' });
    // Same created_at: the id breaks the tie.
    t.tick();
    const same = t.env.now;
    for (const n of [0x50, 0x40]) {
      expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(n), itemId: uuid(1), quote: `tie ${n}`, localDate: '2026-09-11' }, { ...t.env, now: same })).toMatchObject({ ok: true });
    }
    addHighlight(t, 0x60, uuid(1), { note: 'removed one', quote: null });
    addHighlight(t, 0x70, uuid(2), { quote: 'other article' });
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveHighlight', highlightId: uuid(0x60) }, t.env)).toMatchObject({ ok: true });

    const list = t.db.highlights(uuid(1));
    expect(list.map((h) => h.id)).toEqual([uuid(0x30), uuid(0x20), uuid(0x40), uuid(0x50)]);
    expect(list[0]).toMatchObject({ id: uuid(0x30), itemId: uuid(1), quote: 'later id, first', note: null, page: null, localDate: '2026-09-11', deletedAt: null });
    expect(typeof list[0]!.createdAt).toBe('string');
    expect(t.db.highlights(uuid(2)).map((h) => h.quote)).toEqual(['other article']);
  });

  it('a removed item gives [] and its rows are never deleted (H-3); restoring it shows them again', () => {
    const t = openTestDb();
    addArticle(t, 1);
    addHighlight(t, 0x30, uuid(1));
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(1) }, t.env)).toMatchObject({ ok: true });
    expect(t.db.highlights(uuid(1))).toEqual([]);
    expect(t.raw.selectValue('SELECT count(*) FROM highlights WHERE deleted_at IS NULL')).toBe(1);
    t.raw.exec('UPDATE items SET deleted_at = NULL WHERE id = ?', { bind: [uuid(1)] });
    expect(t.db.highlights(uuid(1))).toHaveLength(1);
    expect(t.db.highlights(uuid(999))).toEqual([]);
  });

  it('Edit, Remove and Restore round-trip through dispatch', () => {
    const t = openTestDb();
    addArticle(t, 1);
    addHighlight(t, 0x30, uuid(1));
    t.tick();
    expect(t.db.dispatch({ kind: 'EditHighlightNote', highlightId: uuid(0x30), note: 'my note' }, t.env)).toMatchObject({ ok: true });
    expect(t.db.highlights(uuid(1))[0]).toMatchObject({ quote: 'Quote 48', note: 'my note' });
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveHighlight', highlightId: uuid(0x30) }, t.env)).toMatchObject({ ok: true });
    expect(t.db.highlights(uuid(1))).toEqual([]);
    t.tick();
    expect(t.db.dispatch({ kind: 'RestoreHighlight', highlightId: uuid(0x30) }, t.env)).toMatchObject({ ok: true });
    expect(t.db.highlights(uuid(1))).toHaveLength(1);
    // Unknown ids and ids that exist already are answered by decide().
    expect(t.db.dispatch({ kind: 'RemoveHighlight', highlightId: uuid(0x99) }, t.env)).toMatchObject({ ok: false, error: { kind: 'NotFound' } });
    expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x30), itemId: uuid(1), quote: 'again', localDate: '2026-09-11' }, t.env)).toMatchObject({ ok: false, error: { kind: 'AlreadyExists' } });
    expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x31), itemId: uuid(404), quote: 'x', localDate: '2026-09-11' }, t.env)).toMatchObject({ ok: false, error: { kind: 'NotFound' } });
  });

  it('CHECK constraints reject 5,001 characters and an empty row', () => {
    const t = openTestDb();
    addArticle(t, 1);
    const ins = (quote: string | null, note: string | null) =>
      t.raw.exec('INSERT INTO highlights (id, item_id, quote, note, created_at, local_date) VALUES (?, ?, ?, ?, ?, ?)', {
        bind: [uuid(0x80 + Math.floor(Math.random() * 1e6)), uuid(1), quote, note, '2026-09-11T00:00:00.000Z', '2026-09-11'],
      });
    expect(() => ins('x'.repeat(5001), null)).toThrow();
    expect(() => ins(null, 'x'.repeat(5001))).toThrow();
    expect(() => ins(null, null)).toThrow();
    expect(() => ins('', null)).toThrow();
    expect(() => ins('x'.repeat(5000), null)).not.toThrow();
  });

  it('H-1: stats, articleStats, home and library are deep-equal before and after 100 highlights', () => {
    const t = openTestDb();
    t.tick();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(10), title: 'Dune', totalPages: 400, startNow: true, startEventId: uuid(110), localDate: '2026-09-01' }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'LogEvent', itemId: uuid(10), eventId: uuid(111), type: 'progress', page: 50, localDate: '2026-09-02' }, t.env);
    addArticle(t, 1);
    const snap = () => JSON.stringify([t.db.stats(2026, TODAY), t.db.articleStats(2026, TODAY), t.db.home(), t.db.library(), t.db.articles(), t.db.book(uuid(10), TODAY)]);
    const before = snap();
    for (let i = 0; i < 100; i++) addHighlight(t, 0x1000 + i, uuid(1), { quote: `Passage ${i}`, note: i % 2 ? `Note ${i}` : null });
    expect(t.db.highlights(uuid(1))).toHaveLength(100);
    expect(snap()).toBe(before);
  });
});
