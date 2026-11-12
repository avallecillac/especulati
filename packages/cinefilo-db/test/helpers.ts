import { createHash } from 'node:crypto';
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import type { Instant } from '@especulati/cinefilo-core';
import { CinefiloDb, type DispatchEnv } from '../src/index.ts';

// One wasm module per test file; a fresh in-memory DB per test.
const sqlite3 = await sqlite3InitModule();

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** Same derivation as the shell's `uuidFromHash` (SHA-256, first 16 bytes, v4/variant bits), via node:crypto. */
export function hashId(label: string): string {
  const b = createHash('sha256').update(label).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const hashIdAsync = (label: string): Promise<string> => Promise.resolve(hashId(label));

export function emptyDb(): Database {
  return new sqlite3.oo1.DB(':memory:');
}

export interface TestDb {
  raw: Database;
  db: CinefiloDb;
  env: DispatchEnv;
  tick(ms?: number): void;
}

/** A migrated DB acting as `memberId` (when given), with a fake wall clock. */
export function openTestDb(n = 1, memberId: string | null = null, start = Date.UTC(2026, 8, 27, 12, 0, 0)): TestDb {
  const raw = emptyDb();
  let wall = start;
  let op = 0;
  const env: DispatchEnv = {
    now: new Date(wall).toISOString() as Instant,
    wallMs: () => wall,
    newOpId: () => uuid(n * 0x1000000 + ++op),
  };
  const db = new CinefiloDb(raw);
  db.migrate();
  db.ensureDeviceId(uuid(0xd000 + n));
  if (memberId) db.setMeta('member_id', memberId);
  return {
    raw, db, env,
    tick(ms = 1000) {
      wall += ms;
      env.now = new Date(wall).toISOString() as Instant;
    },
  };
}

export const ANA = uuid(0xa1);
export const BEN = uuid(0xb1);

/** Create both members on `t` and make it act as `as`. */
export function seedMembers(t: TestDb, as: string = ANA): void {
  for (const [id, name] of [[ANA, 'Ana'], [BEN, 'Ben']] as const) {
    t.tick();
    const r = t.db.dispatch({ kind: 'CreateMember', memberId: id, name }, t.env);
    if (!r.ok) throw new Error(`seed member: ${r.error.kind}`);
  }
  t.db.setMeta('member_id', as);
}

/** Add a manual movie with its derived id. */
export function addManual(t: TestDb, title: string, extra: Partial<{ year: number; mediaKind: 'movie' | 'series'; status: 'later' | 'watched'; watchedOn: string }> = {}): string {
  const mediaKind = extra.mediaKind ?? 'movie';
  const id = hashId(`cinefilo-title-v1|manual|${mediaKind}|${title.toLowerCase()}|${extra.year ?? ''}`);
  t.tick();
  const r = t.db.dispatch({ kind: 'AddTitle', titleId: id, mediaKind, title, addedBy: t.db.memberId ?? ANA, ...(extra.year ? { year: extra.year } : {}), ...(extra.status ? { status: extra.status } : {}), ...(extra.watchedOn ? { watchedOn: extra.watchedOn } : {}) }, t.env);
  if (!r.ok) throw new Error(`addManual: ${r.error.kind}`);
  return id;
}

export const ratingIdOf = (titleId: string, memberId: string): string => hashId(`cinefilo-rating-v1|${titleId}|${memberId}`);

/** `stars` are half stars, 1..10 (null clears). */
export function rate(t: TestDb, titleId: string, stars: number | null, review?: string): void {
  const memberId = t.db.memberId!;
  t.tick();
  const r1 = t.db.dispatch({ kind: 'SetStars', titleId, memberId, ratingId: ratingIdOf(titleId, memberId), stars }, t.env);
  if (!r1.ok) throw new Error(`rate: ${r1.error.kind}`);
  if (review !== undefined) {
    t.tick();
    const r2 = t.db.dispatch({ kind: 'SetReview', titleId, memberId, ratingId: ratingIdOf(titleId, memberId), review }, t.env);
    if (!r2.ok) throw new Error(`review: ${r2.error.kind}`);
  }
}

/** Deterministic dump of the logical state (not change_log: op ids differ per device). */
export function dump(raw: Database): string {
  return JSON.stringify(
    ['titles ORDER BY id', 'members ORDER BY id', 'ratings ORDER BY id', 'member_status ORDER BY id', 'recommendations ORDER BY id', 'field_clock ORDER BY tbl, row_id, field'].map((t) => raw.selectArrays(`SELECT * FROM ${t}`)),
  );
}

export const mstatusIdOf = (titleId: string, memberId: string): string => hashId(`cinefilo-mstatus-v1|${titleId}|${memberId}`);
export const recIdOf = (titleId: string, from: string, to: string): string => hashId(`cinefilo-rec-v1|${titleId}|${from}|${to}`);

/** Personal-list helpers: act as `t.db.memberId`. Throw on rejection. */
export function setMine(t: TestDb, titleId: string, status: 'later' | 'watching' | 'watched' | null, watchedOn?: string): void {
  const memberId = t.db.memberId!;
  t.tick();
  const r = t.db.dispatch({ kind: 'SetMyStatus', titleId, memberId, memberStatusId: mstatusIdOf(titleId, memberId), status, ...(watchedOn ? { watchedOn } : {}) }, t.env);
  if (!r.ok) throw new Error(`setMine: ${r.error.kind}`);
}

/** Add a manual title to the device member's own list only ("Just me"). */
export function addJustMe(t: TestDb, title: string, extra: Partial<{ year: number; mediaKind: 'movie' | 'series'; status: 'later' | 'watching' | 'watched'; watchedOn: string }> = {}): string {
  const mediaKind = extra.mediaKind ?? 'movie';
  const id = hashId(`cinefilo-title-v1|manual|${mediaKind}|${title.toLowerCase()}|${extra.year ?? ''}`);
  const memberId = t.db.memberId ?? ANA;
  t.tick();
  const r = t.db.dispatch(
    { kind: 'AddTitle', titleId: id, mediaKind, title, addedBy: memberId, to: 'me', memberStatusId: mstatusIdOf(id, memberId), ...(extra.year ? { year: extra.year } : {}), ...(extra.status ? { status: extra.status } : {}), ...(extra.watchedOn ? { watchedOn: extra.watchedOn } : {}) },
    t.env,
  );
  if (!r.ok) throw new Error(`addJustMe: ${r.error.kind}`);
  return id;
}
