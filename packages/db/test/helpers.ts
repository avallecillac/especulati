import { createHash } from 'node:crypto';
import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import type { DeviceId, Instant, LocalDate } from '@readerlog/core';
import { ReaderlogDb, type DispatchEnv } from '../src/index.ts';

// One wasm module per test file; a fresh in-memory DB per test.
const sqlite3 = await sqlite3InitModule();

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** A fixed `today` for queries that take one. */
export const TODAY = '2026-09-27' as LocalDate;
export const DEVICE = uuid(0xd00d) as DeviceId;

export interface TestDb {
  raw: Database;
  db: ReaderlogDb;
  env: DispatchEnv;
  /** Advance the fake wall clock (ms) and the `now` instant together. */
  tick(ms?: number): void;
}

export function openTestDb(start = Date.UTC(2026, 8, 27, 12, 0, 0)): TestDb {
  const raw = new sqlite3.oo1.DB(':memory:');
  let wall = start;
  let op = 0;
  const env: DispatchEnv = {
    now: new Date(wall).toISOString() as Instant,
    wallMs: () => wall,
    newOpId: () => uuid(0x10000 + ++op),
  };
  const db = new ReaderlogDb(raw);
  db.migrate();
  db.ensureDeviceId(DEVICE);
  return {
    raw,
    db,
    env,
    tick(ms = 1000) {
      wall += ms;
      env.now = new Date(wall).toISOString() as Instant;
    },
  };
}

export function emptyDb(): Database {
  return new sqlite3.oo1.DB(':memory:');
}

const DUMP_TABLES = ['items', 'reading_events', 'tags', 'item_tags', 'field_clock', 'change_log', 'meta'] as const;

/** A deterministic, order-independent logical dump of the given tables. */
export function dumpLogical(raw: Database, tables: readonly string[] = DUMP_TABLES): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    out[t] = raw.selectObjects(`SELECT * FROM ${t}`).map((r) => JSON.stringify(r)).sort();
  }
  return out;
}

/** Same derivation as apps/pwa/src/lib/ids.ts `uuidFromHash` (SHA-256, first 16 bytes, v4/variant bits), via node:crypto. */
export function hashId(label: string): string {
  const b = createHash('sha256').update(label).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Async, like the shell's WebCrypto version, so tests exercise the injected-hash path. */
export const hashIdAsync = (label: string): Promise<string> => Promise.resolve(hashId(label));
export const tagIdOf = (nameKey: string): string => hashId(`readerlog-tag-v1|${nameKey}`);
export const itemTagIdOf = (itemId: string, tagId: string): string => hashId(`readerlog-item-tag-v1|${itemId}|${tagId}`);
