import sqlite3InitModule, { type Database } from '@sqlite.org/sqlite-wasm';
import type { DeviceId, FieldValue, SyncSchema } from '@especulati/sync-core';
import { parseRemoteOpWith, type OpWire, type RemoteOp } from '@especulati/sync-core';
import { SYNC_BOOKKEEPING_DDL, runMigrations, type CanInsert } from '../src/index.ts';

const sqlite3 = await sqlite3InitModule();

export type ToyTable = 'notes' | 'marks';

/** A toy app: `notes`, and `marks` that belong to a note (parent row must exist first). */
export const toySchema: SyncSchema<ToyTable> = {
  writable: {
    notes: new Set(['body', 'deleted_at']),
    marks: new Set(['note_id', 'label', 'deleted_at']),
  },
  insertRequired: { notes: ['body'], marks: ['note_id', 'label'] },
  tierOf: (tbl: ToyTable, fields: Readonly<Record<string, FieldValue>>) => (tbl === 'marks' || fields['body'] === null ? 'm' : 'base'),
};

export const toyCanInsert: CanInsert<ToyTable> = (db, op) => {
  if (!toySchema.insertRequired[op.tbl].every((f) => Object.hasOwn(op.fields, f))) return false;
  if (op.tbl === 'marks') return db.selectValue('SELECT 1 FROM notes WHERE id = ?', [op.fields.note_id]) !== undefined;
  return true;
};

export const TOY_MIGRATIONS: readonly string[] = [
  `${SYNC_BOOKKEEPING_DDL}
   CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL, deleted_at TEXT);
   CREATE TABLE marks (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id), label TEXT NOT NULL, deleted_at TEXT);`,
];

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const DEVICE = uuid(0xd00d) as DeviceId;
export const REMOTE = uuid(0xbeef);
export const h = (ms: number, counter = 0, dev: string = REMOTE): string =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${dev}`;
export const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

export function openToyDb(): Database {
  const raw = new sqlite3.oo1.DB(':memory:');
  runMigrations(raw, TOY_MIGRATIONS);
  raw.exec("INSERT INTO meta (key, value) VALUES ('device_id', ?)", { bind: [DEVICE] });
  return raw;
}

export function emptyDb(): Database {
  return new sqlite3.oo1.DB(':memory:');
}

const parse = parseRemoteOpWith(toySchema);
let n = 0;
export function op(tbl: ToyTable, row: string, fields: OpWire['fields'], hlc: string, opId?: string): RemoteOp<ToyTable> {
  const r = parse({ op: opId ?? uuid(0x7000 + ++n), hlc, tbl, row, fields }, REMOTE);
  if (!r.ok) throw new Error(`bad test op: ${JSON.stringify(r.error)}`);
  return r.value;
}
