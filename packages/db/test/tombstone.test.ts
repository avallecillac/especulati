import { describe, expect, it } from 'vitest';
import { openTestDb, uuid } from './helpers.ts';

describe('removal keeps a record (FR-009)', () => {
  it('a removed entry stays in reading_events with deleted_at, and the removal is in change_log', () => {
    const t = openTestDb();
    const run = (cmd: Parameters<typeof t.db.dispatch>[0]) => { t.tick(); expect(t.db.dispatch(cmd, t.env).ok).toBe(true); };
    run({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', totalPages: 600, startNow: true, startEventId: uuid(101), localDate: '2026-09-01' });
    run({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(102), type: 'progress', page: 500, localDate: '2026-09-02' });
    run({ kind: 'RemoveEvent', itemId: uuid(1), eventId: uuid(102) });

    const row = t.raw.selectObject('SELECT page, deleted_at FROM reading_events WHERE id = ?', [uuid(102)]);
    expect(row).toEqual({ page: 500, deleted_at: t.env.now });
    const last = t.raw.selectObject('SELECT tbl, row_id, fields_json FROM change_log ORDER BY seq DESC LIMIT 1');
    expect(last).toEqual({ tbl: 'reading_events', row_id: uuid(102), fields_json: JSON.stringify({ deleted_at: t.env.now }) });
    expect(t.db.book(uuid(1))!.card.lastPage).toBeNull();
    expect(t.db.book(uuid(1))!.events.map((e) => e.id)).toEqual([uuid(101)]);
  });
});
