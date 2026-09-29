import type { RelayStore, StoredBatch } from './store.ts';

// Minimal local D1 typings (no @cloudflare/workers-types dependency).
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export function d1Store(db: D1Database): RelayStore {
  return {
    async getSpace(id) {
      const row = await db
        .prepare('SELECT token_hash FROM spaces WHERE space_id = ?')
        .bind(id)
        .first<{ token_hash: string }>();
      return row ? { tokenHash: row.token_hash } : null;
    },
    async createSpace(id, tokenHash, now) {
      const r = await db
        .prepare('INSERT OR IGNORE INTO spaces (space_id, token_hash, created_at) VALUES (?, ?, ?)')
        .bind(id, tokenHash, now)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },
    async deleteSpace(id) {
      await db.batch([
        db.prepare('DELETE FROM batches WHERE space_id = ?').bind(id),
        db.prepare('DELETE FROM rate WHERE space_id = ?').bind(id),
        db.prepare('DELETE FROM spaces WHERE space_id = ?').bind(id),
      ]);
    },
    async appendBatch(id, b, now) {
      const ins = await db
        .prepare(
          'INSERT OR IGNORE INTO batches (space_id, batch_id, iv, ct, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, b.batchId, b.iv, b.ct, now)
        .run();
      const duplicate = (ins.meta.changes ?? 0) === 0;
      const row = await db
        .prepare('SELECT seq FROM batches WHERE space_id = ? AND batch_id = ?')
        .bind(id, b.batchId)
        .first<{ seq: number }>();
      return { seq: row?.seq ?? 0, duplicate };
    },
    async listBatches(id, after, limit) {
      const { results } = await db
        .prepare(
          'SELECT seq, batch_id, iv, ct FROM batches WHERE space_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        )
        .bind(id, after, limit)
        .all<{ seq: number; batch_id: string; iv: string; ct: string }>();
      return results.map((r): StoredBatch => ({ seq: r.seq, batchId: r.batch_id, iv: r.iv, ct: r.ct }));
    },
    async hit(id, minute) {
      const row = await db
        .prepare(
          'INSERT INTO rate (space_id, minute, count) VALUES (?, ?, 1) ON CONFLICT (space_id, minute) DO UPDATE SET count = count + 1 RETURNING count',
        )
        .bind(id, minute)
        .first<{ count: number }>();
      return row?.count ?? 1;
    },
    async prune(minuteBefore) {
      await db.prepare('DELETE FROM rate WHERE minute < ?').bind(minuteBefore).run();
    },
  };
}
