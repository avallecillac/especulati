import type { Database } from '@sqlite.org/sqlite-wasm';

/** Local cache of downscaled covers (research R5). Never touches change_log or field_clock. */
export function putCover(db: Database, itemId: string, jpeg: Uint8Array, width: number, height: number, fetchedAt: string): void {
  db.exec(
    `INSERT INTO covers (item_id, mime, bytes, width, height, fetched_at) VALUES (?, 'image/jpeg', ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes,
       width = excluded.width, height = excluded.height, fetched_at = excluded.fetched_at`,
    { bind: [itemId, jpeg, width, height, fetchedAt] },
  );
}

export function getCover(db: Database, itemId: string): { mime: 'image/jpeg'; bytes: Uint8Array } | null {
  const v = db.selectValue('SELECT bytes FROM covers WHERE item_id = ?', [itemId]);
  if (v === undefined || v === null) return null;
  return { mime: 'image/jpeg', bytes: v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike) };
}

/** How much the local cover cache holds (FR-010 budget: under 50 MB per 1,000 books). */
export function coverStats(db: Database): { count: number; bytes: number } {
  const row = db.selectObject('SELECT count(*) AS count, coalesce(sum(length(bytes)), 0) AS bytes FROM covers');
  return { count: Number(row?.['count'] ?? 0), bytes: Number(row?.['bytes'] ?? 0) };
}

export function deleteCover(db: Database, itemId: string): void {
  db.exec('DELETE FROM covers WHERE item_id = ?', { bind: [itemId] });
}
