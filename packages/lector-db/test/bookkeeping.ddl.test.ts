import { describe, expect, it } from 'vitest';
import { runMigrations, SYNC_BOOKKEEPING_DDL } from '@especulati/db-kit';
import { migrate } from '../src/index.ts';
import { emptyDb } from './helpers.ts';

const TABLES = ['field_clock', 'change_log', 'meta', 'sync_inbox'] as const;

function shape(raw: ReturnType<typeof emptyDb>) {
  return TABLES.map((t) => ({
    t,
    columns: raw.selectObjects(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${t}') ORDER BY cid`),
    indexes: raw.selectObjects(
      `SELECT l.name, l."unique", l.origin, l.partial, s.sql
         FROM pragma_index_list('${t}') l LEFT JOIN sqlite_schema s ON s.name = l.name
        ORDER BY l.name`,
    ),
  }));
}

describe('db-kit SYNC_BOOKKEEPING_DDL vs lector migrations', () => {
  it('a bootstrapped DB has the same bookkeeping tables as a migrated lector DB', () => {
    const lector = emptyDb();
    migrate(lector);
    const kit = emptyDb();
    runMigrations(kit, [SYNC_BOOKKEEPING_DDL]);
    expect(shape(kit)).toEqual(shape(lector));
  });
});
