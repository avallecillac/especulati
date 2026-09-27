import type { Database } from '@sqlite.org/sqlite-wasm';
import { hlcNext, type Change, type DeviceId, type Hlc } from '@readerlog/core';

/** Columns a Change may set. Guards against building SQL from untrusted field names. */
const WRITABLE: Readonly<Record<string, ReadonlySet<string>>> = {
  items: new Set([
    'type', 'title', 'author', 'isbn', 'total_pages', 'genre', 'cover_url', 'cover_blob_key',
    'url', 'domain', 'word_count', 'read_on', 'metadata_status', 'rating', 'created_at', 'deleted_at',
  ]),
  reading_events: new Set(['item_id', 'event_type', 'page', 'occurred_at', 'local_date', 'deleted_at']),
};

export function readMeta(db: Database, key: string): string | null {
  const v = db.selectValue('SELECT value FROM meta WHERE key = ?', [key]);
  return typeof v === 'string' ? v : null;
}

export function writeMeta(db: Database, key: string, value: string): void {
  db.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', { bind: [key, value] });
}

function upsertRow(db: Database, change: Change): void {
  const cols = WRITABLE[change.tbl];
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
  db.exec('SAVEPOINT apply_changes');
  try {
    let hlc = readMeta(db, 'hlc') as Hlc | null;
    for (const change of changes) {
      hlc = hlcNext(hlc, wallMs(), deviceId);
      upsertRow(db, change);
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
    db.exec('ROLLBACK TO apply_changes');
    db.exec('RELEASE apply_changes');
    throw e;
  }
}
