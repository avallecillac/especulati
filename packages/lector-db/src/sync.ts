import type { Database } from '@sqlite.org/sqlite-wasm';
import { applyPulledPage as kitApplyPulledPage, applyRemoteOps as kitApplyRemoteOps, unpushedOps as kitUnpushedOps, type CanInsert } from '@especulati/db-kit';
import { INSERT_FIELDS, lectorSchema, type DeviceId, type OpWire, type RemoteOp, type Table } from '@especulati/lector-core';
import type { ApplyResult } from '@especulati/sync-core';

export { completePush, inboxOpIds, markPushed, pendingCount, resetPushState, setSyncMeta, syncMeta } from '@especulati/db-kit';
export type { ApplyResult, SyncMeta, SyncProblem, SyncStatus } from '@especulati/sync-core';

/** Lector's parent-row checks for an op that would create a row (db-kit parks it otherwise). */
export const lectorCanInsert: CanInsert<Table> = (db: Database, op: RemoteOp): boolean => {
  if (!INSERT_FIELDS[op.tbl].every((f) => Object.hasOwn(op.fields, f))) return false;
  // A reading event whose item hasn't arrived yet can't be inserted (foreign key): wait for it.
  // Likewise a highlight whose item hasn't arrived.
  if (op.tbl === 'reading_events' || op.tbl === 'highlights') {
    return db.selectValue('SELECT 1 FROM items WHERE id = ?', [op.fields.item_id]) !== undefined;
  }
  // A tag assignment needs both its item and its tag (008): either missing would break a foreign key.
  if (op.tbl === 'item_tags') {
    return db.selectValue('SELECT 1 FROM items WHERE id = ?', [op.fields.item_id]) !== undefined
      && db.selectValue('SELECT 1 FROM tags WHERE id = ?', [op.fields.tag_id]) !== undefined;
  }
  return true;
};

export function applyRemoteOps(db: Database, ops: readonly RemoteOp[], deviceId: DeviceId, wallMs: () => number): ApplyResult {
  return kitApplyRemoteOps(db, lectorSchema, lectorCanInsert, ops, deviceId, wallMs);
}

/** Apply one pulled page of ops and advance the cursor in the same transaction. */
export function applyPulledPage(db: Database, ops: readonly RemoteOp[], cursor: number, deviceId: DeviceId, wallMs: () => number): ApplyResult {
  return kitApplyPulledPage(db, lectorSchema, lectorCanInsert, ops, cursor, deviceId, wallMs);
}

/** The next batch to push; a new batch is single-tier by `tierOf` (007 contracts/sync-tiers.md). */
export function unpushedOps(db: Database, limit: number, upToSeq?: number): { maxSeq: number; ops: OpWire[] } {
  return kitUnpushedOps(db, lectorSchema, limit, upToSeq);
}
