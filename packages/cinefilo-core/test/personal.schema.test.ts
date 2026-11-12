import { describe, expect, it } from 'vitest';
import { cinefiloSchema, INSERT_FIELDS, parseRemoteOp, tierOf, WRITABLE_FIELDS, type OpWire } from '../src/index.ts';
import { uuid } from './fixtures.ts';

const wire = (tbl: string, fields: OpWire['fields']): OpWire => ({ op: uuid(1), hlc: `0000000000001-0000-${uuid(2)}`, tbl, row: uuid(3), fields });
const parse = (tbl: string, fields: OpWire['fields']) => parseRemoteOp(wire(tbl, fields), uuid(2));

describe('personal lists in the sync schema (D1, D4)', () => {
  it('allow-lists the new tables and their fields', () => {
    expect([...WRITABLE_FIELDS.member_status].sort()).toEqual(['current_season', 'deleted_at', 'member_id', 'status', 'title_id', 'updated_at', 'watched_on']);
    expect([...WRITABLE_FIELDS.recommendations].sort()).toEqual(['answered', 'answered_at', 'created_at', 'deleted_at', 'from_member', 'title_id', 'to_member', 'withdrawn_at']);
    expect(INSERT_FIELDS.member_status).toEqual(['title_id', 'member_id', 'updated_at']);
    expect(INSERT_FIELDS.recommendations).toEqual(['title_id', 'from_member', 'to_member', 'created_at']);
    expect(cinefiloSchema.writable.member_status).toBe(WRITABLE_FIELDS.member_status);
  });
  it('tier p: the new tables and any titles op that writes status null; base otherwise', () => {
    expect(tierOf('member_status', { status: 'later' })).toBe('p');
    expect(tierOf('recommendations', {})).toBe('p');
    expect(tierOf('titles', { status: null, title: 'x' })).toBe('p');
    expect(tierOf('titles', { status: 'later' })).toBe('base');
    expect(tierOf('titles', { title: 'x' })).toBe('base');
    expect(tierOf('members', { name: 'x' })).toBe('base');
    expect(tierOf('ratings', { verdict: null })).toBe('base');
    expect(tierOf('ratings', { review: 'x', updated_at: 'y' })).toBe('base');
    expect(tierOf('ratings', { stars: 4 })).toBe('r');
    expect(tierOf('ratings', { stars: null })).toBe('r');
    expect(tierOf('ratings', { title_id: 'a', member_id: 'b', stars: 3, updated_at: 'y' })).toBe('r');
    expect(cinefiloSchema.tierOf('member_status', {})).toBe('p');
  });
  it('titles.status may be null on the wire, and only there', () => {
    expect(parse('titles', { status: null }).ok).toBe(true);
    expect(parse('titles', { kind: null }).ok).toBe(false);
    expect(parse('titles', { status: 'paused' }).ok).toBe(false);
  });
  it('member_status values are checked', () => {
    expect(parse('member_status', { title_id: uuid(5), member_id: uuid(6), status: 'watching', updated_at: 'x' }).ok).toBe(true);
    expect(parse('member_status', { status: null }).ok).toBe(true);
    expect(parse('member_status', { status: 'dropped' }).ok).toBe(false);
    expect(parse('member_status', { title_id: null }).ok).toBe(false);
    expect(parse('member_status', { member_id: 'nope' }).ok).toBe(false);
    expect(parse('member_status', { merged_into: null }).ok).toBe(false);
  });
  it('recommendation values are checked', () => {
    expect(parse('recommendations', { title_id: uuid(5), from_member: uuid(6), to_member: uuid(7), created_at: 'x', answered: 'accepted', answered_at: 'y' }).ok).toBe(true);
    expect(parse('recommendations', { answered: null, withdrawn_at: null }).ok).toBe(true);
    expect(parse('recommendations', { answered: 'maybe' }).ok).toBe(false);
    expect(parse('recommendations', { from_member: null }).ok).toBe(false);
    expect(parse('recommendations', { to_member: 'x' }).ok).toBe(false);
    expect(parse('recommendations', { password: 'x' }).ok).toBe(false);
  });
});
