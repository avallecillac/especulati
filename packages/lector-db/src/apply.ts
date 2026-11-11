import type { Database } from '@sqlite.org/sqlite-wasm';
import { applyChanges as kitApplyChanges, upsertRow as kitUpsertRow } from '@especulati/db-kit';
import { lectorSchema, type Change, type DeviceId } from '@especulati/lector-core';

export { readMeta, rollbackQuietly, writeMeta } from '@especulati/db-kit';

/** Insert the row, or update the given fields of an existing one. Field names are allow-listed. */
export function upsertRow(db: Database, change: Change): void {
  kitUpsertRow(db, lectorSchema, change);
}

/**
 * Apply changes atomically: rows + field_clock + change_log + meta.hlc (contracts/db-schema.md).
 * Uses a SAVEPOINT so it composes with an enclosing BEGIN IMMEDIATE (dispatch) or stands alone.
 */
export function applyChanges(
  db: Database,
  changes: readonly Change[],
  deviceId: DeviceId,
  wallMs: () => number,
  newOpId: () => string,
): void {
  kitApplyChanges(db, lectorSchema, changes, deviceId, wallMs, newOpId);
}
