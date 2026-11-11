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

  describe('type-rank tie-break on equal (local_date, occurred_at)', () => {
    const lowId = eventId(400);
    const highId = eventId(500);

    it.each([
      ['abandoned has the lower id', lowId, highId],
      ['abandoned has the higher id', highId, lowId],
    ])('progress and started sort before abandoned and finished (%s)', (_name, abandonedId, otherId) => {
      const abandoned = ev({ type: 'abandoned', id: abandonedId });
      const progress = ev({ type: 'progress', id: otherId, page: 120 as Page });
      expect(eventOrder([abandoned, progress]).map((e) => e.type)).toEqual(['progress', 'abandoned']);
      expect(eventOrder([progress, abandoned]).map((e) => e.type)).toEqual(['progress', 'abandoned']);

      const finished = ev({ type: 'finished', id: abandonedId });
      const started = ev({ type: 'started', id: otherId });
      expect(eventOrder([finished, started]).map((e) => e.type)).toEqual(['started', 'finished']);
    });

    it.each([
      ['abandoned has the lower id', lowId, highId],
      ['abandoned has the higher id', highId, lowId],
    ])('deriveStatus is abandoned and lastPage is the progress page (%s)', (_name, abandonedId, progressId) => {
      const abandoned = ev({ type: 'abandoned', id: abandonedId });
      const progress = ev({ type: 'progress', id: progressId, page: 120 as Page });
      expect(deriveStatus([abandoned, progress])).toBe('abandoned');
      expect(lastPage([abandoned, progress])).toBe(120);
    });

    it('equal type rank still falls back to id order', () => {
      const a = ev({ type: 'finished', id: eventId(500) });
      const b = ev({ type: 'abandoned', id: eventId(400) });
      expect(eventOrder([a, b]).map((e) => e.id)).toEqual([b.id, a.id]);
      const c = ev({ type: 'started', id: eventId(500) });
      const d = ev({ type: 'progress', id: eventId(400) });
      expect(eventOrder([c, d]).map((e) => e.id)).toEqual([d.id, c.id]);
    });

    it('different occurred_at still sorts by time, whatever the type', () => {
      const early = ev({ type: 'abandoned', occurredAt: instant('2026-09-01T09:00:00.000Z') });
      const late = ev({ type: 'progress', occurredAt: instant('2026-09-01T11:00:00.000Z') });
      expect(eventOrder([late, early]).map((e) => e.id)).toEqual([early.id, late.id]);
    });
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
