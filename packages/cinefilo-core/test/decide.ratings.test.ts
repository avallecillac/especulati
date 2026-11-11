import { describe, expect, it } from 'vitest';
import { decide, type Command, type Snapshot } from '../src/index.ts';
import { member, memberId, NOW, rating, ratingId, title, titleId } from './fixtures.ts';

const run = (cmd: Command, snap: Snapshot) => decide(snap, cmd, NOW);
const ME = memberId(1);
const base: Snapshot = { title: title(), member: member(), rating: null, deviceMemberId: ME };
const verdict = (v: string | null, p = {}): Command => ({ kind: 'SetVerdict', titleId: titleId(1), memberId: ME, ratingId: ratingId(1), verdict: v as never, ...p });
const review = (r: string, p = {}): Command => ({ kind: 'SetReview', titleId: titleId(1), memberId: ME, ratingId: ratingId(1), review: r, ...p });

describe('SetVerdict', () => {
  it('Rate in one tap: first rating inserts the full row', () => {
    expect(run(verdict('like'), base)).toEqual({
      ok: true,
      value: { changes: [{ tbl: 'ratings', rowId: ratingId(1), fields: { title_id: titleId(1), member_id: ME, verdict: 'like', updated_at: NOW } }] },
    });
  });
  it('Change own verdict: only verdict and updated_at', () => {
    const r = run(verdict('meh'), { ...base, rating: rating({ verdict: 'like' }) });
    expect(r).toEqual({ ok: true, value: { changes: [{ tbl: 'ratings', rowId: ratingId(1), fields: { verdict: 'meh', updated_at: NOW } }] } });
  });
  it('Clear own verdict with null', () => {
    const r = run(verdict(null), { ...base, rating: rating({ verdict: 'like' }) });
    expect(r.ok && r.value.changes[0]!.fields['verdict']).toBeNull();
  });
  it('rejects an unknown verdict', () => {
    expect(run(verdict('love'), base).ok).toBe(false);
  });
  it('Partner\'s rating is read-only: NotYourRating', () => {
    expect(run(verdict('like', { memberId: memberId(2) }), { ...base, member: member({ id: memberId(2) }) })).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
  });
  it('rejects when the device has no member yet', () => {
    expect(run(verdict('like'), { ...base, deviceMemberId: null })).toEqual({ ok: false, error: { kind: 'NotYourRating' } });
  });
  it('rejects an unknown or removed member', () => {
    for (const m of [null, member({ deletedAt: NOW })]) {
      expect(run(verdict('like'), { ...base, member: m })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    }
  });
  it('NotFound when the title is missing, removed or merged away', () => {
    for (const t of [null, title({ deletedAt: NOW }), title({ mergedInto: titleId(2) })]) {
      expect(run(verdict('like'), { ...base, title: t })).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
  });
  it('rejects malformed ids', () => {
    expect(run(verdict('like', { ratingId: 'x' }), base).ok).toBe(false);
  });
});

describe('SetReview', () => {
  const f = (r: ReturnType<typeof run>) => (r.ok ? r.value.changes[0]!.fields : r);
  it('Review without verdict: saved, verdict not written', () => {
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
