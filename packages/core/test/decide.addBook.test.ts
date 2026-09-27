import { describe, expect, it } from 'vitest';
import { decide, deriveStatus, type Command } from '../src/index.ts';
import { applyToSnapshot, book, eventId, itemId, NOW, snap } from './fixtures.ts';

const add = (p: Partial<Extract<Command, { kind: 'AddBook' }>> = {}): Command => ({
  kind: 'AddBook',
  itemId: itemId(1),
  title: 'Dune',
  startNow: false,
  localDate: '2026-09-27',
  ...p,
});

describe('decide AddBook', () => {
  it('title only → one item change with all non-null fields, created_at = now', () => {
    const r = decide(null, add({ title: '  Dune ' }), NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        offerFinish: false,
        changes: [{ tbl: 'items', rowId: itemId(1), fields: { type: 'book', title: 'Dune', created_at: NOW } }],
      },
    });
    expect(deriveStatus(applyToSnapshot(null, r.ok ? r.value.changes : [])!.events)).toBe('queued');
  });

  it('includes optional author, total_pages and genre when given', () => {
    const r = decide(null, add({ author: 'Herbert', totalPages: 600, genre: 'SF' }), NOW);
    expect(r.ok && r.value.changes[0]!.fields).toEqual({ type: 'book', title: 'Dune', author: 'Herbert', total_pages: 600, genre: 'SF', created_at: NOW });
  });

  it('startNow also inserts a started event dated cmd.localDate at now', () => {
    const r = decide(null, add({ startNow: true, startEventId: eventId(1), localDate: '2026-09-26' }), NOW);
    expect(r.ok && r.value.changes[1]).toEqual({
      tbl: 'reading_events',
      rowId: eventId(1),
      fields: { item_id: itemId(1), event_type: 'started', page: null, occurred_at: NOW, local_date: '2026-09-26' },
    });
    expect(deriveStatus(applyToSnapshot(null, r.ok ? r.value.changes : [])!.events)).toBe('reading');
  });

  it('rejects a blank or whitespace title with TitleRequired', () => {
    expect(decide(null, add({ title: '' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
    expect(decide(null, add({ title: ' \t ' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
  });

  it('rejects 0, negative and non-integer total pages with InvalidPageCount', () => {
    for (const totalPages of [0, -10, 12.5, Number.NaN])
      expect(decide(null, add({ totalPages }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidPageCount' } });
  });

  it('AlreadyExists when the snapshot is non-null', () =>
    expect(decide(snap(book()), add(), NOW)).toEqual({ ok: false, error: { kind: 'AlreadyExists' } }));

  it('InvalidInput for a malformed id, date, or startNow without an event id', () => {
    expect(decide(null, add({ itemId: 'x' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'itemId' } });
    expect(decide(null, add({ localDate: '2026-02-30' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'localDate' } });
    expect(decide(null, add({ startNow: true }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'startEventId' } });
  });
});
