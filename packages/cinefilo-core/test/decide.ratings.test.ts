import { describe, expect, it } from 'vitest';
import { decide, type Command, type Snapshot } from '../src/index.ts';
import { member, memberId, NOW, rating, ratingId, title, titleId } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot) => decide(snap, cmd, NOW);
const ME = memberId(1);
const base: Snapshot = { title: title(), member: member(), rating: null, deviceMemberId: ME };
const stars = (v: unknown, p = {}): Command => ({ kind: 'SetStars', titleId: titleId(1), memberId: ME, ratingId: ratingId(1), stars: v as never, ...p });
const review = (r: string, p = {}): Command => ({ kind: 'SetReview', titleId: titleId(1), memberId: ME, ratingId: ratingId(1), review: r, ...p });

describe('SetStars', () => {
  it('Rate in one tap: first rating inserts the full row', () => {
    expect(run(stars(7), base)).toEqual({
      ok: true,
      value: { changes: [{ tbl: 'ratings', rowId: ratingId(1), fields: { title_id: titleId(1), member_id: ME, stars: 7, updated_at: NOW } }] },
    });
  });
  it('Change own stars: only stars and updated_at', () => {
    const r = run(stars(10), { ...base, rating: rating({ stars: 7 as never }) });
    expect(r).toEqual({ ok: true, value: { changes: [{ tbl: 'ratings', rowId: ratingId(1), fields: { stars: 10, updated_at: NOW } }] } });
  });
  it('Clear own stars with null', () => {
    const r = run(stars(null), { ...base, rating: rating({ stars: 7 as never }) });
    expect(r.ok && r.value.changes[0]!.fields['stars']).toBeNull();
    expect(r.ok && 'stars' in r.value.changes[0]!.fields).toBe(true);
  });
  it('accepts the whole range 1..10', () => {
    for (let n = 1; n <= 10; n++) expect(run(stars(n), base).ok, String(n)).toBe(true);
  });
  it('rejects 0, 11, 2.5, "4", NaN', () => {
    for (const v of [0, 11, 2.5, '4', NaN, -1, undefined]) expect(run(stars(v), base).ok, String(v)).toBe(false);
  });
  it('Partner\'s rating is read-only: NotYourRating', () => {
    expect(run(stars(4, { memberId: memberId(2) }), { ...base, member: member({ id: memberId(2) }) })).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
  });
  it('rejects when the device has no member yet', () => {
    expect(run(stars(4), { ...base, deviceMemberId: null })).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
  });
  it('rejects an unknown or removed member', () => {
    for (const m of [null, member({ deletedAt: NOW })]) {
      expect(run(stars(4), { ...base, member: m })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    }
  });
  it('NotFound when the title is missing, removed or merged away', () => {
    for (const t of [null, title({ deletedAt: NOW }), title({ mergedInto: titleId(2) })]) {
      expect(run(stars(4), { ...base, title: t })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
  });
  it('rejects malformed ids', () => {
    expect(run(stars(4, { ratingId: 'x' }), base).ok).toBe(false);
  });
});

describe('SetReview', () => {
  const f = (r: ReturnType<typeof run>) => (r.ok ? r.value.changes[0]!.fields : r);
  it('Review without stars: saved, stars not written', () => {
    expect(f(run(review('  Slow but great '), base))).toEqual({ title_id: titleId(1), member_id: ME, review: 'Slow but great', updated_at: NOW });
  });
  it('empty after trimming clears the review', () => {
    expect(f(run(review('   '), { ...base, rating: rating({ review: 'x' as never }) }))).toEqual({ review: null, updated_at: NOW });
  });
  it('Review too long: TooLong with the limit; exactly 1,000 is fine', () => {
    expect(run(review('a'.repeat(1001)), base)).toEqual({ ok: false, error: { kind: 'TooLong', field: 'review', max: 1000 } });
    expect(run(review('a'.repeat(1000)), base).ok).toBe(true);
  });
  it('NotYourRating applies to reviews too', () => {
    expect(run(review('x', { memberId: memberId(2) }), base)).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
  });
});

describe('members', () => {
  const create = (name: string, id = memberId(2)): Command => ({ kind: 'CreateMember', memberId: id, name });
  it('CreateMember inserts with now', () => {
    expect(run(create(' Lucía '), { member: null })).toEqual({
      ok: true, value: { changes: [{ tbl: 'members', rowId: memberId(2), fields: { name: 'Lucía', created_at: NOW } }] },
    });
  });
  it('blank name rejected; existing id is AlreadyExists', () => {
    expect(run(create('  '), { member: null }).ok).toBe(false);
    expect(run(create('Ana', ME), { member: member() })).toEqual({ ok: false, error: { kind: 'AlreadyExists', id: ME } });
  });
  it('Rename: either device may rename any member', () => {
    expect(run({ kind: 'RenameMember', memberId: memberId(2), name: 'Lu' }, { member: member({ id: memberId(2) }), deviceMemberId: ME })).toEqual({
      ok: true, value: { changes: [{ tbl: 'members', rowId: memberId(2), fields: { name: 'Lu' } }] },
    });
  });
  it('Rename of an unknown or removed member is UnknownMember', () => {
    for (const m of [null, member({ deletedAt: NOW })]) {
      expect(run({ kind: 'RenameMember', memberId: ME, name: 'x' }, { member: m })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    }
  });
  it('RemoveMember tombstones a stray member; not the one this device acts as', () => {
    expect(run({ kind: 'RemoveMember', memberId: memberId(2) }, { member: member({ id: memberId(2) }), deviceMemberId: ME })).toEqual({
      ok: true, value: { changes: [{ tbl: 'members', rowId: memberId(2), fields: { deleted_at: NOW } }] },
    });
    expect(run({ kind: 'RemoveMember', memberId: ME }, { member: member(), deviceMemberId: ME }).ok).toBe(false);
  });
  it('RemoveMember is idempotent on a removed member', () => {
    expect(run({ kind: 'RemoveMember', memberId: memberId(2) }, { member: member({ id: memberId(2), deletedAt: NOW }) })).toEqual({ ok: true, value: { changes: [] } });
  });
});
