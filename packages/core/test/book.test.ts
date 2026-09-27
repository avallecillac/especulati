import { describe, expect, it } from 'vitest';
import { deriveStatus, eventOrder, lastActivity, lastPage, type Page, type ReadingEvent } from '../src/index.ts';
import { day, eventId, instant, itemId } from './fixtures.ts';

let n = 0;
const ev = (p: Partial<ReadingEvent> & Pick<ReadingEvent, 'type'>): ReadingEvent => ({
  id: eventId(++n),
  itemId: itemId(1),
  page: null,
  occurredAt: instant('2026-09-01T10:00:00.000Z'),
  localDate: day('2026-09-01'),
  deletedAt: null,
  ...p,
});

describe('eventOrder', () => {
  it('sorts by (local_date, occurred_at, id) and drops tombstoned events', () => {
    const a = ev({ type: 'progress', localDate: day('2026-09-02'), occurredAt: instant('2026-09-02T08:00:00.000Z') });
    const b = ev({ type: 'started', localDate: day('2026-09-01'), occurredAt: instant('2026-09-03T08:00:00.000Z') }); // backdated
    const c = ev({ type: 'progress', localDate: day('2026-09-02'), occurredAt: instant('2026-09-02T07:00:00.000Z') });
    const d = ev({ type: 'progress', localDate: day('2026-09-03'), deletedAt: instant('2026-09-03T09:00:00.000Z') });
    expect(eventOrder([a, b, c, d]).map((e) => e.id)).toEqual([b.id, c.id, a.id]);
  });

  it('breaks exact ties by id', () => {
    const x = ev({ type: 'progress', id: eventId(500) });
    const y = ev({ type: 'progress', id: eventId(400) });
    expect(eventOrder([x, y]).map((e) => e.id)).toEqual([y.id, x.id]);
  });
});

describe('deriveStatus', () => {
  it('none → queued', () => expect(deriveStatus([])).toBe('queued'));
  it('started → reading', () => expect(deriveStatus([ev({ type: 'started' })])).toBe('reading'));
  it('progress → reading', () => expect(deriveStatus([ev({ type: 'progress' })])).toBe('reading'));
  it('finished → finished', () =>
    expect(deriveStatus([ev({ type: 'started' }), ev({ type: 'finished', localDate: day('2026-09-02') })])).toBe('finished'));
  it('abandoned → abandoned', () =>
    expect(deriveStatus([ev({ type: 'started' }), ev({ type: 'abandoned', localDate: day('2026-09-02') })])).toBe('abandoned'));
  it('only tombstoned events → queued', () =>
    expect(deriveStatus([ev({ type: 'started', deletedAt: instant('2026-09-02T00:00:00.000Z') })])).toBe('queued'));
  it('re-read after finish → reading', () =>
    expect(deriveStatus([ev({ type: 'finished' }), ev({ type: 'progress', localDate: day('2026-09-05') })])).toBe('reading'));
});

describe('lastPage', () => {
  it('null when no page was ever logged', () => expect(lastPage([ev({ type: 'started' })])).toBeNull());
  it('ignores page-less events', () =>
    expect(lastPage([
      ev({ type: 'progress', page: 40 as Page, localDate: day('2026-09-01') }),
      ev({ type: 'progress', page: null, localDate: day('2026-09-02') }),
    ])).toBe(40));
  it('is the last in order, even if lower (re-reading a section)', () =>
    expect(lastPage([
      ev({ type: 'progress', page: 120 as Page, localDate: day('2026-09-01') }),
      ev({ type: 'progress', page: 90 as Page, localDate: day('2026-09-02') }),
    ])).toBe(90));
  it('ignores tombstoned events', () =>
    expect(lastPage([
      ev({ type: 'progress', page: 120 as Page, localDate: day('2026-09-01') }),
      ev({ type: 'progress', page: 500 as Page, localDate: day('2026-09-02'), deletedAt: instant('2026-09-02T01:00:00.000Z') }),
    ])).toBe(120));
});

describe('lastActivity', () => {
  it('null without events, else (localDate, occurredAt) of the last event', () => {
    expect(lastActivity([])).toBeNull();
    const late = ev({ type: 'progress', localDate: day('2026-09-09'), occurredAt: instant('2026-09-09T20:00:00.000Z') });
    expect(lastActivity([ev({ type: 'started' }), late])).toEqual({ localDate: late.localDate, occurredAt: late.occurredAt });
  });
});
