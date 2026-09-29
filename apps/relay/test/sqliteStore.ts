import { readFileSync } from 'node:fs';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { RelayStore } from '../src/store.ts';

const sqlite3 = await sqlite3InitModule();
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export interface TestStore extends RelayStore {
  /** Every stored row as text, for the SC-005 plaintext scan. */
  dumpAll(): string;
}

export function sqliteStore(): TestStore {
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec(schema);
  const one = (sql: string, bind: (string | number)[]) =>
    db.selectObject(sql, bind) as Record<string, unknown> | undefined;
  return {
    getSpace(id) {
      const r = one('SELECT token_hash FROM spaces WHERE space_id = ?', [id]);
      return Promise.resolve(r ? { tokenHash: r.token_hash as string } : null);
    },
    createSpace(id, tokenHash, now) {
      db.exec('INSERT OR IGNORE INTO spaces (space_id, token_hash, created_at) VALUES (?, ?, ?)', {
        bind: [id, tokenHash, now],
      });
      return Promise.resolve(db.changes() > 0);
    },
    deleteSpace(id) {
      for (const t of ['batches', 'rate', 'spaces']) db.exec(`DELETE FROM ${t} WHERE space_id = ?`, { bind: [id] });
      return Promise.resolve();
    },
    appendBatch(id, b, now) {
      db.exec('INSERT OR IGNORE INTO batches (space_id, batch_id, iv, ct, created_at) VALUES (?, ?, ?, ?, ?)', {
        bind: [id, b.batchId, b.iv, b.ct, now],
      });
      const duplicate = db.changes() === 0;
      const r = one('SELECT seq FROM batches WHERE space_id = ? AND batch_id = ?', [id, b.batchId]);
      return Promise.resolve({ seq: r?.seq as number, duplicate });
    },
    listBatches(id, after, limit) {
      const rows = db.selectObjects(
        'SELECT seq, batch_id, iv, ct FROM batches WHERE space_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        [id, after, limit],
      );
      return Promise.resolve(
        rows.map((r) => ({
          seq: r.seq as number,
          batchId: r.batch_id as string,
          iv: r.iv as string,
          ct: r.ct as string,
        })),
      );
    },
    hit(id, minute) {
      const r = one(
        'INSERT INTO rate (space_id, minute, count) VALUES (?, ?, 1) ON CONFLICT (space_id, minute) DO UPDATE SET count = count + 1 RETURNING count',
        [id, minute],
      );
      return Promise.resolve(r?.count as number);
    },
    prune(minuteBefore) {
      db.exec('DELETE FROM rate WHERE minute < ?', { bind: [minuteBefore] });
      return Promise.resolve();
    },
    dumpAll() {
      const out: string[] = [];
      for (const t of ['spaces', 'batches', 'rate']) {
        for (const r of db.selectObjects(`SELECT * FROM ${t}`)) out.push(JSON.stringify(r));
      }
      return out.join('\n');
    },
  };
}
