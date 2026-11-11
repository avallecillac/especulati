import type { Database } from '@sqlite.org/sqlite-wasm';
import type { ApplyResult, DeviceId, OpWire, RemoteOp, SyncMeta, SyncSchema, SyncStore } from '@especulati/sync-core';
import { readMeta } from './apply.ts';
import {
  applyPulledPage, completePush, inboxOpIds, pendingCount, resetPushState, setSyncMeta, syncMeta, unpushedOps,
  type CanInsert,
} from './sync.ts';

/**
 * `SyncStore` over a migrated SQLite DB. The device id is the one in `meta.device_id`, which the
 * app writes when it first opens the DB. `onApply` runs before a pulled page is applied, so an app
 * can drop caches (a search index) that the page is about to make stale.
 */
export class SqliteSyncStore<T extends string> implements SyncStore {
  constructor(
    readonly raw: Database,
    readonly schema: SyncSchema<T>,
    readonly canInsert: CanInsert<T>,
    readonly onApply?: () => void,
  ) {}

  syncMeta(): SyncMeta {
    return syncMeta(this.raw);
  }

  setSyncMeta(patch: Partial<Omit<SyncMeta, 'cursor'>> & { cursor?: number | null }): void {
    setSyncMeta(this.raw, patch);
  }

  getMeta(key: string): string | null {
    return readMeta(this.raw, key);
  }

  inboxOpIds(): string[] {
    return inboxOpIds(this.raw);
  }

  applyPulledPage(ops: readonly RemoteOp[], cursor: number, wallMs: () => number): ApplyResult {
    const deviceId = readMeta(this.raw, 'device_id') as DeviceId | null;
    if (!deviceId) throw new Error('the device id must be set before applyPulledPage()');
    this.onApply?.();
    return applyPulledPage(this.raw, this.schema, this.canInsert, ops as readonly RemoteOp<T>[], cursor, deviceId, wallMs);
  }

  unpushedOps(limit: number, upToSeq?: number): { maxSeq: number; ops: OpWire[] } {
    return unpushedOps(this.raw, this.schema, limit, upToSeq);
  }

  completePush(maxSeq: number): void {
    completePush(this.raw, maxSeq);
  }

  resetPushState(): void {
    resetPushState(this.raw);
  }

  pendingCount(): number {
    return pendingCount(this.raw);
  }
}
