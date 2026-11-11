import { describe, expect, it } from 'vitest';
import { migrate } from '../src/index.ts';
import { emptyDb } from './helpers.ts';

// Pins the sync bookkeeping tables as lector's migrations leave them. db-kit's
// SYNC_BOOKKEEPING_DDL (extract-shared-sync 3.4) must stay equivalent to this.
const TABLES = ['field_clock', 'change_log', 'meta', 'sync_inbox'] as const;

function snapshot() {
  const raw = emptyDb();
  migrate(raw);
  const out: Record<string, { columns: unknown[]; indexes: unknown[] }> = {};
  for (const t of TABLES) {
    out[t] = {
      columns: raw.selectObjects(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('${t}') ORDER BY cid`),
      indexes: raw.selectObjects(
        `SELECT l.name, l."unique", l.origin, l.partial, s.sql
           FROM pragma_index_list('${t}') l LEFT JOIN sqlite_schema s ON s.name = l.name
          ORDER BY l.name`,
      ),
    };
  }
  return out;
}

describe('sync bookkeeping schema', () => {
  it('matches the recorded snapshot after migrate()', () => {
    expect(snapshot()).toMatchInlineSnapshot(`
      {
        "change_log": {
          "columns": [
            {
              "dflt_value": null,
              "name": "seq",
              "notnull": 0,
              "pk": 1,
              "type": "INTEGER",
            },
            {
              "dflt_value": null,
              "name": "op_id",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "hlc",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "device_id",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "tbl",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "row_id",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "fields_json",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": "0",
              "name": "pushed",
              "notnull": 1,
              "pk": 0,
              "type": "INTEGER",
            },
          ],
          "indexes": [
            {
              "name": "idx_changelog_unpushed",
              "origin": "c",
              "partial": 1,
              "sql": "CREATE INDEX idx_changelog_unpushed ON change_log(seq)                     WHERE pushed = 0",
              "unique": 0,
            },
            {
              "name": "sqlite_autoindex_change_log_1",
              "origin": "u",
              "partial": 0,
              "sql": null,
              "unique": 1,
            },
          ],
        },
        "field_clock": {
          "columns": [
            {
              "dflt_value": null,
              "name": "tbl",
              "notnull": 1,
              "pk": 1,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "row_id",
              "notnull": 1,
              "pk": 2,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "field",
              "notnull": 1,
              "pk": 3,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "hlc",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
          ],
          "indexes": [
            {
              "name": "sqlite_autoindex_field_clock_1",
              "origin": "pk",
              "partial": 0,
              "sql": null,
              "unique": 1,
            },
          ],
        },
        "meta": {
          "columns": [
            {
              "dflt_value": null,
              "name": "key",
              "notnull": 1,
              "pk": 1,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "value",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
          ],
          "indexes": [
            {
              "name": "sqlite_autoindex_meta_1",
              "origin": "pk",
              "partial": 0,
              "sql": null,
              "unique": 1,
            },
          ],
        },
        "sync_inbox": {
          "columns": [
            {
              "dflt_value": null,
              "name": "op_id",
              "notnull": 0,
              "pk": 1,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "hlc",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "device_id",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "tbl",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "row_id",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
            {
              "dflt_value": null,
              "name": "fields_json",
              "notnull": 1,
              "pk": 0,
              "type": "TEXT",
            },
          ],
          "indexes": [
            {
              "name": "sqlite_autoindex_sync_inbox_1",
              "origin": "pk",
              "partial": 0,
              "sql": null,
              "unique": 1,
            },
          ],
        },
      }
    `);
  });
});
