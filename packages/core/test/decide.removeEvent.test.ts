import { describe, expect, it } from 'vitest';
import { decide, deriveStatus, type Page } from '../src/index.ts';
import { applyToSnapshot, book, day, event, eventId, itemId, NOW, snap } from './fixtures.ts';

const started = event({ type: 'started', id: eventId(1) });
const p120 = event({ type: 'progress', id: eventId(2), page: 120 as Page, localDate: day('2026-09-02') });

describe('decide RemoveEvent', () => {
  it('emits exactly one change: deleted_at = now on reading_events', () =>
    expect(decide(snap(book(), [started, p120]), { kind: 'RemoveEvent', itemId: itemId(1), eventId: eventId(2) }, NOW)).toEqual({
      ok: true,
      value: { offerFinish: false, changes: [{ tbl: 'reading_events', rowId: eventId(2), fields: { deleted_at: NOW } }] },
    }));

  it('removing an already-removed event emits zero changes', () => {
    const removed = { ...p120, deletedAt: NOW };
    expect(decide(snap(book(), [started, removed]), { kind: 'RemoveEvent', itemId: itemId(1), eventId: eventId(2) }, NOW))
      .toEqual({ ok: true, value: { offerFinish: false, changes: [] } });
  });

  it('removing the only started event returns the book to queued', () => {
    const s = snap(book(), [started]);
    const r = decide(s, { kind: 'RemoveEvent', itemId: itemId(1), eventId: eventId(1) }, NOW);
    expect(deriveStatus(applyToSnapshot(s, r.ok ? r.value.changes : [])!.events)).toBe('queued');
  });

  it('NotFound for an unknown event id or a removed book', () => {
    expect(decide(snap(book(), [started]), { kind: 'RemoveEvent', itemId: itemId(1), eventId: eventId(9) }, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(book({ deletedAt: NOW }), [started]), { kind: 'RemoveEvent', itemId: itemId(1), eventId: eventId(1) }, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});
