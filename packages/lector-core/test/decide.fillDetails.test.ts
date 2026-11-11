import { describe, expect, it } from 'vitest';
import { decide, type Command, type Item } from '../src/index.ts';
import { book, event, itemId, NOW, snap } from './fixtures.ts';

const ISBN = '9780593135204' as Item['isbn'];
const PLACEHOLDER = `ISBN ${ISBN}` as Item['title'];
const pending = (p: Partial<Item> = {}) => book({ title: PLACEHOLDER, isbn: ISBN, totalPages: null, detailsStatus: 'pending', ...p });
const fill = (details: Extract<Command, { kind: 'FillDetails' }>['details'], outcome: 'found' | 'notFound' = 'found'): Command => ({
  kind: 'FillDetails', itemId: itemId(1), outcome, ...(details ? { details } : {}),
});
const changesOf = (s: ReturnType<typeof snap> | null, c: Command) => {
  const r = decide(s, c, NOW);
  if (!r.ok) throw new Error(`rejected: ${JSON.stringify(r.error)}`);
  return r.value.changes;
};
const fieldsOf = (s: ReturnType<typeof snap>, c: Command) => {
  const ch = changesOf(s, c);
  expect(ch).toHaveLength(1);
  expect(ch[0]).toMatchObject({ tbl: 'items', rowId: itemId(1) });
  return ch[0]!.fields;
};

describe('decide: FillDetails', () => {
  it('rejects a missing, removed or non-book item with NotFound', () => {
    expect(decide(null, fill({}), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(pending({ deletedAt: NOW })), fill({}), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(pending({ type: 'article' })), fill({}), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });

  it('rejects a malformed itemId or unknown outcome with InvalidInput', () => {
    const bad = decide(snap(pending()), { kind: 'FillDetails', itemId: 'nope', outcome: 'found' }, NOW);
    expect(bad).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'itemId' } });
    const odd = decide(snap(pending()), { kind: 'FillDetails', itemId: itemId(1), outcome: 'maybe' as 'found' }, NOW);
    expect(odd).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'outcome' } });
  });

  it('emits zero changes on a non-pending book (invariant 7)', () => {
    for (const detailsStatus of ['complete', 'notFound'] as const) {
      for (const outcome of ['found', 'notFound'] as const) {
        expect(changesOf(snap(pending({ detailsStatus })), fill({ author: 'X' }, outcome))).toEqual([]);
      }
    }
  });

  it('notFound sets metadata_status failed', () => {
    expect(fieldsOf(snap(pending()), fill(undefined, 'notFound'))).toEqual({ metadata_status: 'failed' });
    expect(fieldsOf(snap(pending()), fill({ author: 'Ignored' }, 'notFound'))).toEqual({ metadata_status: 'failed' });
  });

  it('found with no details only clears the pending status', () => {
    expect(fieldsOf(snap(pending()), fill(undefined))).toEqual({ metadata_status: 'ok' });
  });

  it('found fills every empty field', () => {
    expect(fieldsOf(snap(pending()), fill({ title: ' Project Hail Mary ', author: 'Andy Weir', genre: 'Fiction', totalPages: 476, coverUrl: 'https://c.example/a.jpg' }))).toEqual({
      metadata_status: 'ok', title: 'Project Hail Mary', author: 'Andy Weir', genre: 'Fiction', total_pages: 476, cover_url: 'https://c.example/a.jpg',
    });
  });

  it('fills the placeholder title but not a typed title', () => {
    expect(fieldsOf(snap(pending()), fill({ title: 'Real' }))).toEqual({ metadata_status: 'ok', title: 'Real' });
    expect(fieldsOf(snap(pending({ title: 'Mine' as Item['title'] })), fill({ title: 'Real' }))).toEqual({ metadata_status: 'ok' });
  });

  it('never fills the title when the book has no isbn', () => {
    expect(fieldsOf(snap(pending({ isbn: null })), fill({ title: 'Real' }))).toEqual({ metadata_status: 'ok' });
  });

  it('fills author, genre and cover_url only when null', () => {
    const full = pending({ author: 'Me' as Item['author'], genre: 'G' as Item['genre'], coverUrl: 'https://mine.example/c.png' as Item['coverUrl'] });
    expect(fieldsOf(snap(full), fill({ author: 'A', genre: 'B', coverUrl: 'https://x.example/y.png' }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending({ author: 'Me' as Item['author'] })), fill({ author: 'A', genre: 'B' }))).toEqual({ metadata_status: 'ok', genre: 'B' });
  });

  it('fills total_pages only when null', () => {
    expect(fieldsOf(snap(pending({ totalPages: 300 as Item['totalPages'] })), fill({ totalPages: 476 }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending()), fill({ totalPages: 476 }))).toEqual({ metadata_status: 'ok', total_pages: 476 });
  });

  it('skips total_pages below the highest logged page, without error', () => {
    const events = [event({ type: 'started' }), event({ type: 'progress', page: 120 as never })];
    expect(fieldsOf(snap(pending(), events), fill({ totalPages: 100 }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending(), events), fill({ totalPages: 120 }))).toEqual({ metadata_status: 'ok', total_pages: 120 });
  });

  it('skips invalid detail values silently and still becomes ok', () => {
    const f = fieldsOf(snap(pending()), fill({
      title: '   ', author: 'a'.repeat(501), genre: 'g'.repeat(201), totalPages: 0, coverUrl: 'http://x.example/c.jpg',
    }));
    expect(f).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending()), fill({ totalPages: 1.5 }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending()), fill({ totalPages: 100001 }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending()), fill({ coverUrl: 'https://x.example/' + 'a'.repeat(500) }))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(snap(pending()), fill({ author: null, genre: null, coverUrl: null, totalPages: null }))).toEqual({ metadata_status: 'ok' });
  });

  it('is deterministic', () => {
    const s = snap(pending());
    const c = fill({ author: 'A', totalPages: 10 });
    expect(decide(s, c, NOW)).toEqual(decide(s, c, NOW));
  });
});
