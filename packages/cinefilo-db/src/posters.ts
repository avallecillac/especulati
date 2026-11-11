import type { Database } from '@sqlite.org/sqlite-wasm';

/** Local cache of downscaled posters (design D8). Never touches change_log or field_clock, and is never exported. */
export function putPoster(db: Database, titleId: string, mime: string, bytes: Uint8Array, fetchedAt: string): void {
  db.exec(
    `INSERT INTO posters (title_id, mime, bytes, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(title_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, fetched_at = excluded.fetched_at`,
    { bind: [titleId, mime, bytes, fetchedAt] },
  );
}

export function getPoster(db: Database, titleId: string): { mime: string; bytes: Uint8Array } | null {
  const r = db.selectObject('SELECT mime, bytes FROM posters WHERE title_id = ?', [titleId]);
  if (!r) return null;
  const v = r['bytes'];
  const mime = r['mime'];
  return { mime: typeof mime === 'string' ? mime : 'image/jpeg', bytes: v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike) };
}
