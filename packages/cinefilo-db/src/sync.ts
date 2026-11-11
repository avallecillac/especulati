import type { Database } from '@sqlite.org/sqlite-wasm';
import type { CanInsert } from '@especulati/db-kit';
import { INSERT_FIELDS, type Table } from '@especulati/cinefilo-core';

/**
 * Parent-row check for an op that would create a row (db-kit parks it otherwise): every insert-required
 * field, and for a rating its title, so a read model never meets a rating whose title has not arrived.
 */
export const cinefiloCanInsert: CanInsert<Table> = (db: Database, op): boolean => {
  if (!INSERT_FIELDS[op.tbl].every((f) => Object.hasOwn(op.fields, f))) return false;
  if (op.tbl === 'ratings') return db.selectValue('SELECT 1 FROM titles WHERE id = ?', [op.fields['title_id']]) !== undefined;
  return true;
};
