import type { Database } from '@sqlite.org/sqlite-wasm';
import { SqliteSyncStore, applyChanges, readMeta, rollbackQuietly, writeMeta } from '@especulati/db-kit';
import { cinefiloSchema, decide, err, ok, type Command, type Instant, type Rejection, type Result, type Table, type VerdictFilter, type Kind } from '@especulati/cinefilo-core';
import type { DeviceId } from '@especulati/sync-core';
import { exportData, exportText, importText, type ImportResult } from './io.ts';
import { importTitles, type ImportEnv, type ImportTitlesResult } from './importTitles.ts';
import { migrate } from './migrations.ts';
import { getPoster, putPoster } from './posters.ts';
import {
  findByTmdb, list, members, needsDetails, pendingRecommendations, titleDetail,
  type ListItem, type ListScope, type NeedsDetails, type ListTab, type MemberView, type PendingRecommendation, type TitleDetail,
} from './queries.ts';
import { loadSnapshot } from './snapshot.ts';
import type { DispatchEnv, DispatchOutcome } from './types.ts';
import { cinefiloCanInsert } from './sync.ts';

export { migrate, MIGRATIONS, SCHEMA_VERSION } from './migrations.ts';
export { cinefiloCanInsert } from './sync.ts';
export { cinefiloSyncApp } from './syncApp.ts';
export { ENVELOPE_AAD_PREFIX, QR_PREFIX, SYNC_SALT } from './frozen.ts';
export { reconcileAll, type Hash } from './reconcile.ts';
export { importTitles, type ImportEnv, type ImportTitlesResult } from './importTitles.ts';
export { exportData, exportText, importText, type ImportResult } from './io.ts';
export type {
  ListItem, ListScope, ListTab, NeedsDetails, MemberView, MemberStatusView, PendingRecommendation, RatingView, RecommendationState, RecommendationView, TitleDetail,
} from './queries.ts';
export { loadSnapshot, loadReconcileSnapshot } from './snapshot.ts';

export type { DispatchEnv, DispatchOutcome } from './types.ts';

export class CinefiloDb {
  #deviceId: DeviceId | null = null;

  /** The engine's view of the sync bookkeeping: db-kit over cinefilo's schema. */
  readonly syncStore: SqliteSyncStore<Table>;

  constructor(readonly raw: Database) {
    this.syncStore = new SqliteSyncStore(raw, cinefiloSchema, cinefiloCanInsert);
  }

  migrate(): void {
    migrate(this.raw);
  }

  get schemaVersion(): number {
    return Number(this.raw.selectValue('PRAGMA user_version') ?? 0);
  }

  /** Returns the device id, creating it on first open. */
  ensureDeviceId(newId: string): DeviceId {
    const existing = readMeta(this.raw, 'device_id');
    if (existing) return (this.#deviceId = existing as DeviceId);
    writeMeta(this.raw, 'device_id', newId);
    return (this.#deviceId = newId as DeviceId);
  }

  getMeta(key: string): string | null {
    return readMeta(this.raw, key);
  }

  setMeta(key: string, value: string): void {
    writeMeta(this.raw, key, value);
  }

  /** `meta.member_id`: the member this device acts as ("who am I"). Local only, never synced. */
  get memberId(): string | null {
    return readMeta(this.raw, 'member_id');
  }

  /** The local poster cache (never synced or exported). */
  putPoster(titleId: string, mime: string, bytes: Uint8Array, fetchedAt: string): void {
    putPoster(this.raw, titleId, mime, bytes, fetchedAt);
  }

  getPoster(titleId: string): { mime: string; bytes: Uint8Array } | null {
    return getPoster(this.raw, titleId);
  }

  members(): MemberView[] {
    return members(this.raw);
  }

  /** `scope` defaults to Together; `me` and `partner` are the personal lists (the partner's is read-only for the UI). */
  list(tab: ListTab, filter?: VerdictFilter, scope: ListScope = 'together'): ListItem[] {
    return list(this.raw, tab, filter, scope);
  }

  /** Open recommendations to this device's member, newest first. */
  pendingRecommendations(): PendingRecommendation[] {
    return pendingRecommendations(this.raw);
  }

  title(id: string): TitleDetail | null {
    return titleDetail(this.raw, id);
  }

  needsDetails(limit = 20): NeedsDetails[] {
    return needsDetails(this.raw, limit);
  }

  findByTmdb(tmdbId: number, kind: Kind): string | null {
    return findByTmdb(this.raw, tmdbId, kind);
  }

  exportData(exportedAt: Instant) {
    return exportData(this.raw, exportedAt);
  }

  exportText(exportedAt: Instant): string {
    return exportText(this.raw, exportedAt);
  }

  /** Merge a `cinefilo/v1` file by id, all or nothing (see `importText`). */
  import(text: string, env: Pick<DispatchEnv, 'wallMs' | 'newOpId'>): Result<ImportResult, { field: string; reason: string }> {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before import()');
    return importText(this.raw, text, deviceId, env.wallMs, env.newOpId);
  }

  /**
   * Import a `cinefilo-titles/v1` list as this device's member: preview with `dryRun`, otherwise one transaction.
   * Any invalid entry blocks the write (all or nothing).
   */
  importTitles(text: string, env: ImportEnv, opts: { dryRun?: boolean } = {}): Promise<Result<ImportTitlesResult, { field: string; reason: string }>> {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before importTitles()');
    return importTitles(this.raw, text, deviceId, this.memberId, env, opts);
  }

  /** Read → decide → apply in one transaction; nothing is ever partially applied. */
  dispatch(cmd: Command, env: DispatchEnv): Result<DispatchOutcome, Rejection> {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before dispatch()');
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const decision = decide(loadSnapshot(this.raw, cmd, this.memberId), cmd, env.now);
      if (!decision.ok) {
        this.raw.exec('ROLLBACK');
        return err(decision.error);
      }
      applyChanges(this.raw, cinefiloSchema, decision.value.changes, deviceId, env.wallMs, env.newOpId);
      this.raw.exec('COMMIT');
      return ok({ changes: decision.value.changes.length });
    } catch (e) {
      rollbackQuietly(this.raw, 'ROLLBACK');
      throw e;
    }
  }
}
