import { describe, expect, it } from 'vitest';
import { openTestDb, uuid } from './helpers.ts';

describe('home query', () => {
  it('current = the reading book with the latest activity; counts queued; ignores removed', () => {
    const t = openTestDb();
    const run = (cmd: Parameters<typeof t.db.dispatch>[0]) => { t.tick(); expect(t.db.dispatch(cmd, t.env).ok).toBe(true); };
    run({ kind: 'AddBook', itemId: uuid(1), title: 'Old', startNow: true, startEventId: uuid(101), localDate: '2026-09-01' });
    run({ kind: 'AddBook', itemId: uuid(2), title: 'New', startNow: true, startEventId: uuid(102), localDate: '2026-09-20' });
    run({ kind: 'AddBook', itemId: uuid(3), title: 'Queued A', startNow: false, localDate: '2026-09-20' });
    run({ kind: 'AddBook', itemId: uuid(4), title: 'Queued B', startNow: false, localDate: '2026-09-20' });

    const home = t.db.home();
    expect(home.current?.title).toBe('New');
    expect(home.current?.status).toBe('reading');
    expect(home.otherReading.map((c) => c.title)).toEqual(['Old']);
    expect(home.queuedCount).toBe(2);
  });

  it('empty database → no current book', () => {
    expect(openTestDb().db.home()).toEqual({ current: null, otherReading: [], queuedCount: 0 });
  });
});
