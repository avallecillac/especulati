import { parseRemoteOpWith, type OpWire, type ParseError, type RemoteOp as SyncRemoteOp, type Result, type SyncSchema } from '@especulati/sync-core';
import type { FieldValue, Table } from './commands.ts';

/**
 * Columns a Change (local or remote) may set, per table. Guards against building SQL from
 * untrusted field names. `id` is never writable: the row id travels separately.
 */
export const WRITABLE_FIELDS: Readonly<Record<Table, ReadonlySet<string>>> = {
  items: new Set([
    'type', 'title', 'author', 'isbn', 'total_pages', 'genre', 'cover_url', 'cover_blob_key',
    'url', 'domain', 'word_count', 'read_on', 'metadata_status', 'rating', 'created_at', 'deleted_at',
    'merged_into',
  ]),
  reading_events: new Set(['item_id', 'event_type', 'page', 'occurred_at', 'local_date', 'deleted_at']),
  duplicate_dismissals: new Set(['item_a', 'item_b', 'created_at', 'deleted_at']),
  highlights: new Set(['item_id', 'quote', 'note', 'page', 'created_at', 'local_date', 'deleted_at']),
  tags: new Set(['name', 'name_key', 'created_at', 'deleted_at']),
  item_tags: new Set(['item_id', 'tag_id', 'created_at', 'deleted_at']),
};

/** Fields an op must carry to create a row that does not exist yet (else it is parked). */
export const INSERT_FIELDS: Readonly<Record<Table, readonly string[]>> = {
  items: ['type', 'title', 'created_at'],
  reading_events: ['item_id', 'event_type', 'occurred_at', 'local_date'],
  duplicate_dismissals: ['item_a', 'item_b', 'created_at'],
  highlights: ['item_id', 'created_at', 'local_date'],
  tags: ['name', 'name_key', 'created_at'],
  item_tags: ['item_id', 'tag_id', 'created_at'],
};

/**
 * Sync batch tier (007 R2, 008 R2): a pushed batch never mixes tiers, so an older device skips only
 * whole batches it can't read. `h` highlights; `t` tags and item_tags; `s` an items op that sets
 * `read_on` to null (a saved article, which 0.8.0 cannot read); `base` everything else. The `s` test
 * needs the key present with a null value, so a saved insert must name `read_on` explicitly.
 * Lives in core so db and sync share it.
 */
export function tierOf(tbl: Table, fields: Readonly<Record<string, FieldValue>>): 'base' | 'h' | 't' | 's' {
  if (tbl === 'highlights') return 'h';
  if (tbl === 'tags' || tbl === 'item_tags') return 't';
  if (tbl === 'items' && Object.prototype.hasOwnProperty.call(fields, 'read_on') && fields['read_on'] === null) return 's';
  return 'base';
}

/** Lector's allow-list, insert-required fields and batch tiers as sync-core's schema. */
export const lectorSchema: SyncSchema<Table> = { writable: WRITABLE_FIELDS, insertRequired: INSERT_FIELDS, tierOf };

export type RemoteOp = SyncRemoteOp<Table>;

/**
 * Validate untrusted wire data: known table, allow-listed fields, well-formed ids and HLC.
 * The op's device is the one named in its HLC, not the batch sender (see sync-core).
 */
export const parseRemoteOp: (w: OpWire, device: string) => Result<RemoteOp, ParseError> = parseRemoteOpWith(lectorSchema);
