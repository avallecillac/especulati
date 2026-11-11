// A toy app (notes, and marks that belong to a note) over db-kit, so the generic engine is proven
// without lector. Salt, AAD and QR prefix differ from lector's on purpose.
import type { Database } from '@sqlite.org/sqlite-wasm';
import { applyChanges, SqliteSyncStore } from '@especulati/db-kit';
import { parseRemoteOpWith, type DeviceId } from '@especulati/sync-core';
import { createSyncEngine, type SyncApp, type SyncEngine } from '../src/index.ts';
import { openToyDb, toyCanInsert, toySchema, uuid, type ToyTable } from '../../db-kit/test/helpers.ts';
import { fakeRelay, prng, randomBytes, type FakeRelay } from './relayHarness.ts';

export { fakeRelay, prng, randomBytes, uuid };
export type { FakeRelay };

export const toyApp: SyncApp = {
  salt: 'toy-sync-v1',
  aadPrefix: 'toy/v1',
  qrPrefix: 'toy:sync:1:',
  parseOp: parseRemoteOpWith(toySchema),
};

export interface ToyPeer {
  n: number;
  raw: Database;
  store: SqliteSyncStore<ToyTable>;
  engine: SyncEngine;
  device: DeviceId;
  online: boolean;
  /** Advance this peer's clock (ms). */
  tick(ms?: number): void;
  /** Write one note (a local change: row, field_clock and change_log in one transaction). */
  addNote(body: string, id?: string): string;
  /** Write one mark on a note. */
  addMark(noteId: string, label: string, id?: string): string;
  close(): void;
}

export function makeToyPeer(n: number, relay: FakeRelay, rng: () => number = prng(n), start = Date.UTC(2026, 8, 27, 12, 0, 0)): ToyPeer {
  const raw = openToyDb();
  const device = uuid(0xd000 + n) as DeviceId;
  raw.exec("UPDATE meta SET value = ? WHERE key = 'device_id'", { bind: [device] });
  const store = new SqliteSyncStore(raw, toySchema, toyCanInsert);
  let wall = start;
  let opN = 0;
  let rowN = 0;
  const newOpId = () => uuid(n * 0x1000000 + ++opN);
  const write = (tbl: ToyTable, rowId: string, fields: Record<string, string | null>) =>
    applyChanges(raw, toySchema, [{ tbl, rowId, fields }], device, () => wall, newOpId);
  const peer: ToyPeer = {
    n,
    raw,
    store,
    device,
    online: true,
    tick(ms = 1000) {
      wall += ms;
    },
    addNote(body, id = uuid(n * 0x100000 + 0x80000 + ++rowN)) {
      peer.tick();
      write('notes', id, { body });
      return id;
    },
    addMark(noteId, label, id = uuid(n * 0x100000 + 0x80000 + ++rowN)) {
      peer.tick();
      write('marks', id, { note_id: noteId, label });
      return id;
    },
    engine: undefined as never,
    close: () => raw.close(),
  };
  peer.engine = createSyncEngine({ store, app: toyApp, fetch: relay.fetch, now: () => wall, random: randomBytes(rng), online: () => peer.online });
  return peer;
}
