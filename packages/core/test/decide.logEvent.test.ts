import { describe, expect, it } from 'vitest';
import { decide, deriveStatus, type Command, type EventType, type Page } from '../src/index.ts';
import { applyToSnapshot, book, day, event, eventId, itemId, NOW, snap } from './fixtures.ts';

const log = (type: EventType, page?: number | null, p: Partial<Extract<Command, { kind: 'LogEvent' }>> = {}): Command => ({
  kind: 'LogEvent',
  itemId: itemId(1),
  eventId: eventId(1),
  type,
  ...(page === undefined ? {} : { page }),
  localDate: '2026-09-27',
  ...p,
});
const reading = snap(book(), [event({ type: 'started' }), event({ type: 'progress', page: 120 as Page, localDate: day('2026-09-02') })]);
const rejected = (kind: string) => ({ ok: false, error: expect.objectContaining({ kind }) as unknown });

describe('decide LogEvent: progress with a page', () => {
  it('emits one event insert with all fields', () => {
    expect(decide(reading, log('progress', 145), NOW)).toEqual({
      ok: true,
      value: {
        offerFinish: false,
        changes: [{
          tbl: 'reading_events',
          rowId: eventId(1),
          fields: { item_id: itemId(1), event_type: 'progress', page: 145, occurred_at: NOW, local_date: '2026-09-27' },
        }],
      },
    });
  });

  it('rejects non-integer or ≤ 0 pages with InvalidPage', () => {
    for (const page of [0, -1, 2.5, Number.NaN]) expect(decide(reading, log('progress', page), NOW)).toEqual(rejected('InvalidPage'));
  });

  it('rejects a page above total_pages with PageBeyondEnd', () =>
    expect(decide(reading, log('progress', 301), NOW)).toEqual({ ok: false, error: { kind: 'PageBeyondEnd', totalPages: 300 } }));

  it('accepts any page when total_pages is unknown', () =>
    expect(decide(snap(book({ totalPages: null }), reading.events), log('progress', 5000), NOW).ok).toBe(true));

  it('accepts a page lower than the last page (re-reading)', () => expect(decide(reading, log('progress', 90), NOW).ok).toBe(true));

  it('offerFinish only when page === total_pages', () => {
    const at = (page: number) => { const r = decide(reading, log('progress', page), NOW); return r.ok && r.value.offerFinish; };
    expect(at(300)).toBe(true);
    expect(at(299)).toBe(false);
    expect(decide(snap(book({ totalPages: null }), reading.events), log('progress', 300), NOW)).toMatchObject({ ok: true, value: { offerFinish: false } });
  });
});

describe('decide LogEvent: other kinds and transitions', () => {
  it('progress without a page ("read today") is accepted', () => {
    const r = decide(reading, log('progress', null), NOW);
    expect(r.ok && r.value.changes[0]!.fields['page']).toBeNull();
  });

  it('a page on started, finished or abandoned is PageNotAllowed', () => {
    for (const t of ['started', 'finished', 'abandoned'] as const) expect(decide(reading, log(t, 10), NOW)).toEqual(rejected('PageNotAllowed'));
  });

  it('progress on a queued book is allowed and results in reading', () => {
    const queued = snap(book());
    const r = decide(queued, log('progress', 10), NOW);
    expect(r.ok).toBe(true);
    expect(deriveStatus(applyToSnapshot(queued, r.ok ? r.value.changes : [])!.events)).toBe('reading');
  });

  it('finished/abandoned require reading, else InvalidTransition', () => {
    const queued = snap(book());
    expect(decide(queued, log('finished'), NOW)).toEqual({ ok: false, error: { kind: 'InvalidTransition', from: 'queued', type: 'finished' } });
    expect(decide(queued, log('abandoned'), NOW)).toEqual(rejected('InvalidTransition'));
    expect(decide(reading, log('finished'), NOW).ok).toBe(true);
    expect(decide(reading, log('abandoned'), NOW).ok).toBe(true);
  });

  it('started on a reading book is InvalidTransition; on finished/abandoned it starts a re-read', () => {
    expect(decide(reading, log('started'), NOW)).toEqual(rejected('InvalidTransition'));
    const done = snap(book(), [...reading.events, event({ type: 'finished', localDate: day('2026-09-10') })]);
    expect(decide(done, log('started'), NOW).ok).toBe(true);
  });

  it('NotFound for an unknown or removed book', () => {
    expect(decide(null, log('progress', 1), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(book({ deletedAt: NOW })), log('progress', 1), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });

  it('AlreadyExists when the event id is taken', () =>
    expect(decide(reading, log('progress', 1, { eventId: reading.events[0]!.id }), NOW)).toEqual({ ok: false, error: { kind: 'AlreadyExists' } }));

  it('InvalidInput for a malformed local date', () =>
    expect(decide(reading, log('progress', 1, { localDate: '27/09/2026' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'localDate' } }));
});
