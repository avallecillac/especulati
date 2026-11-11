import type { Database } from '@sqlite.org/sqlite-wasm';
import { hlcNext, type Change, type DeviceId, type Hlc, type SyncSchema } from '@especulati/sync-core';

/**
 * Run cleanup after a failed write without masking the original error. On SQLITE_FULL/IOERR/
 * NOMEM SQLite may already have rolled the transaction back itself, so an explicit ROLLBACK can
 * fail with "no transaction is active" — that is expected and ignored here.
 */
export function rollbackQuietly(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch {
    // Already rolled back by SQLite; the caller rethrows the original error.
  }
}

export function readMeta(db: Database, key: string): string | null {
  const v = db.selectValue('SELECT value FROM meta WHERE key = ?', [key]);
  return typeof v === 'string' ? v : null;
}

export function writeMeta(db: Database, key: string, value: string): void {
  db.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', { bind: [key, value] });
}

/** Insert the row, or update the given fields of an existing one. Field names are allow-listed by `schema`. */
export function upsertRow<T extends string>(db: Database, schema: SyncSchema<T>, change: Change<T>): void {
  const cols = Object.hasOwn(schema.writable, change.tbl) ? schema.writable[change.tbl] : undefined;
  if (!cols) throw new Error(`unknown table: ${change.tbl}`);
  const entries = Object.entries(change.fields);
  for (const [col] of entries) if (!cols.has(col)) throw new Error(`unknown column ${change.tbl}.${col}`);

  const exists = db.selectValue(`SELECT 1 FROM ${change.tbl} WHERE id = ?`, [change.rowId]) !== undefined;
  if (exists) {
    db.exec(`UPDATE ${change.tbl} SET ${entries.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, {
      bind: [...entries.map(([, v]) => v), change.rowId],
    });
  } else {
    db.exec(`INSERT INTO ${change.tbl} (id${entries.map(([c]) => `, ${c}`).join('')}) VALUES (?${', ?'.repeat(entries.length)})`, {
      bind: [change.rowId, ...entries.map(([, v]) => v)],
    });
  }
}

/**
 * Apply changes atomically: rows + field_clock + change_log + meta.hlc.
 * Uses a SAVEPOINT so it composes with an enclosing BEGIN IMMEDIATE (dispatch) or stands alone.
 */
export function applyChanges<T extends string>(
  db: Database,
  schema: SyncSchema<T>,
  changes: readonly Change<T>[],
  deviceId: DeviceId,
  wallMs: () => number,
  newOpId: () => string,
): void {
  db.exec('SAVEPOINT apply_changes');
  try {
    let hlc = readMeta(db, 'hlc') as Hlc | null;
    for (const change of changes) {
      hlc = hlcNext(hlc, wallMs(), deviceId);
      upsertRow(db, schema, change);
      for (const field of Object.keys(change.fields)) {
        db.exec(
          `INSERT INTO field_clock (tbl, row_id, field, hlc) VALUES (?, ?, ?, ?)
           ON CONFLICT(tbl, row_id, field) DO UPDATE SET hlc = excluded.hlc`,
          { bind: [change.tbl, change.rowId, field, hlc] },
        );
      }
      db.exec(
        'INSERT INTO change_log (op_id, hlc, device_id, tbl, row_id, fields_json) VALUES (?, ?, ?, ?, ?, ?)',
        { bind: [newOpId(), hlc, deviceId, change.tbl, change.rowId, JSON.stringify(change.fields)] },
      );
    }
    if (hlc !== null) writeMeta(db, 'hlc', hlc);
    db.exec('RELEASE apply_changes');
  } catch (e) {
    rollbackQuietly(db, 'ROLLBACK TO apply_changes');
    rollbackQuietly(db, 'RELEASE apply_changes');
    throw e;
  }
}
