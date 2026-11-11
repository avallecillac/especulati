import { describe, expect, it } from 'vitest';
import { cinefiloSchema, decide, parseRemoteOp, parseTitlesFile, tierOf, WRITABLE_FIELDS, TITLES_FORMAT, type Command, type OpWire, type Snapshot } from '../src/index.ts';
import { day, hlc, NOW, title, titleId, uuid } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot) => {
  const r = decide(snap, cmd, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.changes;
};
const setStatus = (status: string, watchedOn?: string): Command => ({ kind: 'SetStatus', titleId: titleId(1), status: status as never, ...(watchedOn ? { watchedOn } : {}) });

describe('watch_order in the sync schema (D3)', () => {
  it('is writable and a titles op that writes it is tier p', () => {
    expect(WRITABLE_FIELDS.titles.has('watch_order')).toBe(true);
    expect(tierOf('titles', { status: 'watched', watch_order: 3 })).toBe('p');
    expect(tierOf('titles', { watch_order: null })).toBe('p');
    expect(tierOf('titles', { status: 'watched', watched_on: null })).toBe('base');
    expect(cinefiloSchema.tierOf('titles', { watch_order: 1 })).toBe('p');
  });
  it('accepts positive integers and null, refuses the rest', () => {
    const op = (v: unknown): OpWire => ({ op: uuid(5000), hlc: hlc(1000), tbl: 'titles', row: titleId(1), fields: { watch_order: v as never } });
    const dev = uuid(9001);
    for (const ok of [1, 264, null]) expect(parseRemoteOp(op(ok), dev).ok).toBe(true);
    for (const bad of [0, -1, 1.5, '3']) expect(parseRemoteOp(op(bad), dev).ok).toBe(false);
  });
});

describe('decide: assigning the watch order (D2)', () => {
  it('SetStatus watched with an empty history gets 1', () => {
    expect(run(setStatus('watched', '2026-09-24'), { title: title(), maxWatchOrder: null })[0]!.fields).toEqual({ status: 'watched', watched_on: '2026-09-24', watch_order: 1 });
  });
  it('gets max + 1', () => {
    expect(run(setStatus('watched'), { title: title(), maxWatchOrder: 263 })[0]!.fields['watch_order']).toBe(264);
  });
  it('keeps an existing order when re-marked', () => {
    expect(run(setStatus('watched', '2026-09-26'), { title: title({ status: 'watched', watchOrder: 7 }), maxWatchOrder: 9 })[0]!.fields).toEqual({ status: 'watched', watched_on: '2026-09-26' });
  });
  it('clears it on leaving watched', () => {
    expect(run(setStatus('later'), { title: title({ status: 'watched', watchedOn: day('2026-09-20'), watchOrder: 7 }), maxWatchOrder: 9 })[0]!.fields).toEqual({ status: 'later', watched_on: null, watch_order: null });
  });
  it('does not write the field for other statuses without one', () => {
    expect(run(setStatus('later'), { title: title({ status: 'watching' }), maxWatchOrder: 9 })[0]!.fields).toEqual({ status: 'later', watched_on: null });
  });
  it('AddTitle as watched on Together assigns; as later does not', () => {
    const add = (status: string): Command => ({ kind: 'AddTitle', titleId: titleId(1), mediaKind: 'movie', title: 'Stalker', status: status as never, addedBy: '00000000-0000-4000-8000-000000000065' });
    expect(run(add('watched'), { title: null, maxWatchOrder: 4 })[0]!.fields['watch_order']).toBe(5);
    expect('watch_order' in run(add('later'), { title: null, maxWatchOrder: 4 })[0]!.fields).toBe(false);
  });
  it('personal statuses never touch it', () => {
    const cmd: Command = { kind: 'SetMyStatus', titleId: titleId(1), memberId: '00000000-0000-4000-8000-000000000065', memberStatusId: '00000000-0000-4000-8000-00000000012d', status: 'watched' };
    const changes = run(cmd, { title: title(), member: { id: '00000000-0000-4000-8000-000000000065', name: 'Ana', createdAt: NOW, deletedAt: null } as never, memberStatus: null, deviceMemberId: '00000000-0000-4000-8000-000000000065', maxWatchOrder: 3 });
    expect(JSON.stringify(changes)).not.toContain('watch_order');
  });
});

describe('titles file watchOrder (D4)', () => {
  const file = (titles: unknown[]) => JSON.stringify({ format: TITLES_FORMAT, titles });
  const w = (n: number, extra = {}) => ({ kind: 'movie', title: `Film ${n}`, status: 'watched', watchOrder: n, ...extra });
  it('accepts it on watched entries', () => {
    const r = parseTitlesFile(file([w(1), w(2)]));
    expect(r.ok && r.value.titles.map((t) => t.watchOrder)).toEqual([1, 2]);
  });
  it('defaults to null when absent', () => {
    const r = parseTitlesFile(file([{ kind: 'movie', title: 'A', status: 'watched' }]));
    expect(r.ok && r.value.titles[0]!.watchOrder).toBe(null);
  });
  it('refuses zero, negatives, fractions and strings', () => {
    for (const bad of [0, -2, 1.5, '3']) {
      const r = parseTitlesFile(file([{ ...w(1), watchOrder: bad }]));
      expect(r.ok ? null : r.error.field).toBe('titles[0].watchOrder');
    }
  });
  it('refuses duplicates within the file', () => {
    const r = parseTitlesFile(file([w(1), w(2), { ...w(3), watchOrder: 1 }]));
    expect(r.ok ? null : r.error).toEqual({ field: 'titles[2].watchOrder', reason: 'duplicate of titles[0]' });
  });
  it('refuses it on a title that is not watched', () => {
    const r = parseTitlesFile(file([w(1, { status: 'later' })]));
    expect(r.ok ? null : r.error.field).toBe('titles[0].watchOrder');
  });
});
