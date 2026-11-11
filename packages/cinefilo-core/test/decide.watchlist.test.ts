import { describe, expect, it } from 'vitest';
import { decide, type Command, type Snapshot } from '../src/index.ts';
import { day, NOW, title, titleId } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot) => decide(snap, cmd, NOW);
const fieldsOf = (cmd: Command, snap: Snapshot) => {
  const r = run(cmd, snap);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  expect(r.value.changes).toHaveLength(1);
  return r.value.changes[0]!.fields;
};
const setStatus = (status: string, watchedOn?: string): Command => ({ kind: 'SetStatus', titleId: titleId(1), status: status as never, ...(watchedOn ? { watchedOn } : {}) });
const setSeason = (season: number): Command => ({ kind: 'SetCurrentSeason', titleId: titleId(1), season });
const series = (p = {}) => title({ kind: 'series', ...p });

describe('SetStatus', () => {
  it('Mark watched with a date: status and watched_on in ONE change', () => {
    const r = run(setStatus('watched', '2026-09-24'), { title: title() });
    expect(r).toEqual({ ok: true, value: { changes: [{ tbl: 'titles', rowId: titleId(1), fields: { status: 'watched', watched_on: '2026-09-24' } }] } });
  });
  it('Backdate: any valid earlier day is kept as given', () => {
    expect(fieldsOf(setStatus('watched', '2026-09-24'), { title: title() })['watched_on']).toBe('2026-09-24');
  });
  it('Marking watched again replaces the date', () => {
    expect(fieldsOf(setStatus('watched', '2026-09-26'), { title: title({ status: 'watched', watchedOn: day('2026-09-20') }) })['watched_on']).toBe('2026-09-26');
  });
  it('Back to later clears the watched date (ratings are not touched: one change on titles)', () => {
    expect(fieldsOf(setStatus('later'), { title: title({ status: 'watched', watchedOn: day('2026-09-20') }) })).toEqual({ status: 'later', watched_on: null });
  });
  it('watching clears the date too', () => {
    expect(fieldsOf(setStatus('watching'), { title: series({ status: 'later' }) })).toEqual({ status: 'watching', watched_on: null });
  });
  it('Dropped series carries a date', () => {
    expect(fieldsOf(setStatus('dropped', '2026-09-01'), { title: series({ status: 'watching' }) })).toEqual({ status: 'dropped', watched_on: '2026-09-01' });
  });
  it('Movies cannot be watching or dropped', () => {
    for (const s of ['watching', 'dropped']) {
      const r = run(setStatus(s, '2026-09-01'), { title: title() });
      expect(r.ok).toBe(false);
    }
  });
  it('watched and dropped require a valid date', () => {
    expect(run(setStatus('watched'), { title: title() }).ok).toBe(false);
    expect(run(setStatus('watched', '2026-02-30'), { title: title() }).ok).toBe(false);
  });
  it('rejects unknown statuses', () => {
    expect(run(setStatus('done'), { title: title() }).ok).toBe(false);
  });
  it('NotFound for a missing, removed or merged title', () => {
    for (const t of [null, title({ deletedAt: NOW }), title({ mergedInto: titleId(2) })]) {
      expect(run(setStatus('later'), { title: t })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
  });
});

describe('SetCurrentSeason', () => {
  it('Set current season', () => {
    expect(run(setSeason(3), { title: series({ status: 'watching', seasonCount: 5 }) })).toEqual({
      ok: true, value: { changes: [{ tbl: 'titles', rowId: titleId(1), fields: { current_season: 3 } }] },
    });
  });
  it('Season out of range: below 1 or above a known count', () => {
    expect(run(setSeason(0), { title: series() }).ok).toBe(false);
    expect(run(setSeason(6), { title: series({ seasonCount: 5 }) })).toEqual({ ok: false, error: { kind: 'SeasonOutOfRange', max: 5 } });
    expect(run(setSeason(5), { title: series({ seasonCount: 5 }) }).ok).toBe(true);
  });
  it('any positive season is fine when the count is unknown', () => {
    expect(run(setSeason(40), { title: series({ seasonCount: null }) }).ok).toBe(true);
  });
  it('only series have seasons', () => {
    expect(run(setSeason(1), { title: title() })).toEqual({ ok: false, error: { kind: 'NotASeries' } });
  });
  it('Status and season are separate changes on separate fields, so both survive a concurrent edit', () => {
    expect(Object.keys(fieldsOf(setSeason(2), { title: series() }))).toEqual(['current_season']);
    expect(Object.keys(fieldsOf(setStatus('watching'), { title: series() }))).not.toContain('current_season');
  });
});
