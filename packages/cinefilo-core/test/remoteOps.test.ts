import { describe, expect, it } from 'vitest';
import { cinefiloSchema, INSERT_FIELDS, parseRemoteOp, tierOf, WRITABLE_FIELDS, type OpWire } from '../src/index.ts';
import { hlc, memberId, titleId, uuid } from './fixtures.ts';

const DEV = uuid(9001);
const op = (p: Partial<OpWire> = {}): OpWire => ({ op: uuid(5000), hlc: hlc(1000), tbl: 'titles', row: titleId(1), fields: { status: 'watched' }, ...p });

describe('remote-op allow-list', () => {
  it('accepts a well-formed op on each table', () => {
    expect(parseRemoteOp(op(), DEV).ok).toBe(true);
    expect(parseRemoteOp(op({ tbl: 'members', row: memberId(1), fields: { name: 'Ana' } }), DEV).ok).toBe(true);
    expect(parseRemoteOp(op({ tbl: 'ratings', fields: { verdict: 'like', review: 'ok', updated_at: '2026-01-01T00:00:00.000Z' } }), DEV).ok).toBe(true);
  });
  it('rejects unknown tables, including prototype keys', () => {
    for (const tbl of ['items', 'meta', 'posters', 'field_clock', '__proto__', 'toString']) expect(parseRemoteOp(op({ tbl }), DEV).ok, tbl).toBe(false);
  });
  it('rejects unknown and non-writable fields (id is never writable)', () => {
    expect(parseRemoteOp(op({ fields: { id: titleId(2) } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ fields: { nope: 1 } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ tbl: 'members', row: memberId(1), fields: { status: 'later' } }), DEV).ok).toBe(false);
  });
  it('rejects malformed row, op and device ids', () => {
    expect(parseRemoteOp(op({ row: 'abc' }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ op: 'abc' }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op(), 'dev').ok).toBe(false);
  });
  it('rejects malformed reference ids in fields', () => {
    for (const [tbl, field] of [['titles', 'added_by'], ['titles', 'merged_into'], ['ratings', 'title_id'], ['ratings', 'member_id']] as const) {
      expect(parseRemoteOp(op({ tbl, fields: { [field]: 'not-a-uuid' } }), DEV).ok, field).toBe(false);
      expect(parseRemoteOp(op({ tbl, fields: { [field]: uuid(3) } }), DEV).ok, field).toBe(true);
    }
    expect(parseRemoteOp(op({ fields: { merged_into: null } }), DEV).ok).toBe(true);
  });
  it('rejects values the DB checks would refuse, so one bad op cannot roll back a batch', () => {
    expect(parseRemoteOp(op({ fields: { status: 'done' } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ fields: { kind: 'show' } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ tbl: 'ratings', fields: { verdict: 'love' } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ tbl: 'ratings', fields: { review: 'a'.repeat(1001) } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ tbl: 'ratings', fields: { review: 'a'.repeat(1000) } }), DEV).ok).toBe(true);
    expect(parseRemoteOp(op({ fields: { genres: 'not json' } }), DEV).ok).toBe(false);
    expect(parseRemoteOp(op({ fields: { genres: '["Drama"]' } }), DEV).ok).toBe(true);
    expect(parseRemoteOp(op({ fields: { status: 5 } }), DEV).ok).toBe(false);
  });
  it('takes the op device from its HLC', () => {
    const r = parseRemoteOp(op({ hlc: hlc(1000, 7) }), DEV);
    expect(r.ok && r.value.deviceId).toBe(uuid(9007));
  });
});

describe('schema', () => {
  it('has exactly the five tables, writable fields never include id', () => {
    expect(Object.keys(cinefiloSchema.writable).sort()).toEqual(['member_status', 'members', 'ratings', 'recommendations', 'titles']);
    for (const set of Object.values(WRITABLE_FIELDS)) expect(set.has('id')).toBe(false);
  });
  it('local-only data (posters, meta, tmdb key) is not writable', () => {
    const all = Object.values(WRITABLE_FIELDS).flatMap((s) => [...s]);
    expect(all).not.toContain('tmdb_key');
    expect(all).not.toContain('bytes');
  });
  it('insert fields are a subset of writable', () => {
    for (const [t, fs] of Object.entries(INSERT_FIELDS)) for (const f of fs) expect(WRITABLE_FIELDS[t as keyof typeof WRITABLE_FIELDS].has(f)).toBe(true);
  });
  it('AddTitle and the first rating insert carry every insert-required field', () => {
    expect(INSERT_FIELDS.titles).toEqual(['kind', 'title', 'status', 'added_by', 'created_at']);
    expect(INSERT_FIELDS.ratings).toEqual(['title_id', 'member_id', 'updated_at']);
    expect(INSERT_FIELDS.members).toEqual(['name', 'created_at']);
  });
  it('single batch tier: every table is base', () => {
    for (const t of ['titles', 'members', 'ratings'] as const) expect(tierOf(t, { status: 'later' })).toBe('base');
  });
});
