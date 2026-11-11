import { describe, expect, it } from 'vitest';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { migrate } from '../src/index.ts';
import { dumpLogical, emptyDb, openTestDb, uuid } from './helpers.ts';

/**
 * Rebuild a DB purely from change_log with per-field LWW in HLC order
 * (contracts/change-log.md). Kept test-local: sync (feature 004) will own the real merge.
 */
function replayInto(target: Database, log: Record<string, unknown>[]): void {
  const sorted = [...log].sort((a, b) => (a['hlc'] as string).localeCompare(b['hlc'] as string));
  for (const e of sorted) {
    const tbl = e['tbl'] as string;
    const rowId = e['row_id'] as string;
    const hlc = e['hlc'] as string;
    const fields = JSON.parse(e['fields_json'] as string) as Record<string, string | number | null>;
    const newer = Object.entries(fields).filter(([f]) => {
      const cur = target.selectValue('SELECT hlc FROM field_clock WHERE tbl=? AND row_id=? AND field=?', [tbl, rowId, f]);
      return cur === undefined || (cur as string) < hlc;
    });
    if (newer.length === 0) continue;
    const exists = target.selectValue(`SELECT 1 FROM ${tbl} WHERE id=?`, [rowId]) !== undefined;
    if (exists) {
      target.exec(`UPDATE ${tbl} SET ${newer.map(([f]) => `${f}=?`).join(',')} WHERE id=?`, { bind: [...newer.map(([, v]) => v), rowId] });
    } else {
      target.exec(`INSERT INTO ${tbl} (id, ${newer.map(([f]) => f).join(',')}) VALUES (?${',?'.repeat(newer.length)})`, { bind: [rowId, ...newer.map(([, v]) => v)] });
    }
    for (const [f] of newer) {
      target.exec('INSERT INTO field_clock VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET hlc=excluded.hlc', { bind: [tbl, rowId, f, hlc] });
    }
  }
}

describe('change_log replay (FR-011, quickstart scenario 13)', () => {
  it('rebuilds items, events and field clocks identical to the source', () => {
    const t = openTestDb();
    const a = uuid(1), b = uuid(2), e1 = uuid(101), e2 = uuid(102), e3 = uuid(103);
    const run = (cmd: Parameters<typeof t.db.dispatch>[0]) => { t.tick(); const r = t.db.dispatch(cmd, t.env); expect(r.ok).toBe(true); };
    run({ kind: 'AddBook', itemId: a, title: 'Dune', author: 'Herbert', totalPages: 600, startNow: true, startEventId: e1, localDate: '2026-09-01' });
    run({ kind: 'AddBook', itemId: b, title: 'Solaris', startNow: false, localDate: '2026-09-01' });
    run({ kind: 'LogEvent', itemId: a, eventId: e2, type: 'progress', page: 120, localDate: '2026-09-02' });
    run({ kind: 'LogEvent', itemId: a, eventId: e3, type: 'progress', page: 500, localDate: '2026-09-03' });
    run({ kind: 'RemoveEvent', itemId: a, eventId: e3 });
    run({ kind: 'EditBook', itemId: a, title: 'Dune (Deluxe)' });
    run({ kind: 'RemoveBook', itemId: b });

    const target = emptyDb();
    migrate(target);
    replayInto(target, t.raw.selectObjects('SELECT * FROM change_log'));

    const tables = ['items', 'reading_events', 'field_clock'];
    expect(dumpLogical(target, tables)).toEqual(dumpLogical(t.raw, tables));
  });
});
