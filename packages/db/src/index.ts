import type { Database } from '@sqlite.org/sqlite-wasm';
import { decide, err, ok, type BookSnapshot, type BooksSnapshot, type Command, type OpWire, type RemoteOp, type DeviceId, type Instant, type LocalDate, type Article, type ArticleStats, type Rejection, type Result, type StatsView } from '@readerlog/core';
import { applyChanges, readMeta, rollbackQuietly, writeMeta } from './apply.ts';
import { migrate } from './migrations.ts';
import { loadBookSnapshot, loadBooksSnapshot, mergeChainIds } from './snapshot.ts';
import { coverStats, deleteCover, getCover, putCover } from './covers.ts';
import { articleStatsView, statsView } from './stats.ts';
import { applyPulledPage, applyRemoteOps, completePush, inboxOpIds, markPushed, pendingCount, resetPushState, setSyncMeta, syncMeta, unpushedOps, type ApplyResult, type SyncMeta } from './sync.ts';
import { article, articles, bookView, findArticleByUrl, duplicatePairs, findByIsbn, homeView, missingCovers, pendingDetails, libraryView, stragglers, type ArticleCursor, type BookCard, type BookView, type DuplicatePairView, type HomeView, type LibraryView, type StragglerView } from './queries.ts';

export { applyChanges, readMeta, writeMeta } from './apply.ts';
export { migrate, SCHEMA_VERSION } from './migrations.ts';
export { loadBookSnapshot, loadBooksSnapshot, mergeChainIds } from './snapshot.ts';
export { applyPulledPage, applyRemoteOps, completePush, inboxOpIds, markPushed, pendingCount, resetPushState, setSyncMeta, syncMeta, unpushedOps } from './sync.ts';
export type { ApplyResult, SyncMeta, SyncProblem, SyncStatus } from './sync.ts';
export { articleStatsView, loadArticles, loadStatsBooks, statsView } from './stats.ts';

/** Everything impure the write path needs, injected by the shell (or a test). */
export interface DispatchEnv {
  now: Instant;
  wallMs: () => number;
  newOpId: () => string;
}

export interface DispatchOutcome {
  readonly offerFinish: boolean;
}

export class ReaderlogDb {
  #deviceId: DeviceId | null = null;

  constructor(readonly raw: Database) {}

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

  duplicates(): DuplicatePairView[] {
    return duplicatePairs(this.raw);
  }

  stragglers(): StragglerView[] {
    return stragglers(this.raw);
  }

  home(): HomeView {
    return homeView(this.raw);
  }

  library(): LibraryView {
    return libraryView(this.raw);
  }

  book(itemId: string): BookView | null {
    return bookView(this.raw, itemId);
  }

  stats(year: number, today: LocalDate): StatsView {
    return statsView(this.raw, year, today);
  }

  articleStats(year: number, today: LocalDate): ArticleStats {
    return articleStatsView(this.raw, year, today);
  }

  articles(opts?: { limit?: number; before?: ArticleCursor }): Article[] {
    return articles(this.raw, opts);
  }

  article(itemId: string): Article | null {
    return article(this.raw, itemId);
  }

  findArticleByUrl(url: string): Article[] {
    return findArticleByUrl(this.raw, url);
  }

  findByIsbn(isbn: string): BookCard | null {
    return findByIsbn(this.raw, isbn);
  }

  pendingDetails(): { itemId: string; isbn: string }[] {
    return pendingDetails(this.raw);
  }

  missingCovers(): { itemId: string; coverUrl: string }[] {
    return missingCovers(this.raw);
  }

  /** Cover cache: local only, never in change_log (research R5). */
  putCover(itemId: string, jpeg: Uint8Array, width: number, height: number, fetchedAt: string): void {
    putCover(this.raw, itemId, jpeg, width, height, fetchedAt);
  }

  getCover(itemId: string): { mime: 'image/jpeg'; bytes: Uint8Array } | null {
    return getCover(this.raw, itemId);
  }

  deleteCover(itemId: string): void {
    deleteCover(this.raw, itemId);
  }

  coverStats(): { count: number; bytes: number } {
    return coverStats(this.raw);
  }

  /** Merge ops pulled from the relay (constitution IV, remote-changes exception). */
  applyRemoteOps(ops: readonly RemoteOp[], wallMs: () => number): ApplyResult {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before applyRemoteOps()');
    return applyRemoteOps(this.raw, ops, deviceId, wallMs);
  }

  /** Apply one pulled page and advance `sync_cursor` in the same transaction. */
  applyPulledPage(ops: readonly RemoteOp[], cursor: number, wallMs: () => number): ApplyResult {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before applyPulledPage()');
    return applyPulledPage(this.raw, ops, cursor, deviceId, wallMs);
  }

  unpushedOps(limit: number, upToSeq?: number): { maxSeq: number; ops: OpWire[] } {
    return unpushedOps(this.raw, limit, upToSeq);
  }

  /** Mark rows up to `maxSeq` pushed and clear `pending_batch`, in one step. */
  completePush(maxSeq: number): void {
    completePush(this.raw, maxSeq);
  }

  pendingCount(): number {
    return pendingCount(this.raw);
  }

  inboxOpIds(): string[] {
    return inboxOpIds(this.raw);
  }

  markPushed(maxSeq: number): void {
    markPushed(this.raw, maxSeq);
  }

  resetPushState(): void {
    resetPushState(this.raw);
  }

  syncMeta(): SyncMeta {
    return syncMeta(this.raw);
  }

  setSyncMeta(patch: Partial<Omit<SyncMeta, 'cursor'>> & { cursor?: number | null }): void {
    setSyncMeta(this.raw, patch);
  }

  /** The snapshot each command kind needs: one book, or several for merge/dismiss (contracts/commands-004.md). */
  #snapshotFor(cmd: Command): BookSnapshot | BooksSnapshot | null {
    switch (cmd.kind) {
      case 'MergeBooks':
        return loadBooksSnapshot(this.raw, [cmd.survivorId, ...mergeChainIds(this.raw, cmd.duplicateId)]);
      case 'DismissDuplicate':
        return loadBooksSnapshot(this.raw, [cmd.itemA, cmd.itemB]);
      default:
        return loadBookSnapshot(this.raw, cmd.itemId);
    }
  }

  /** Read → decide → apply in one transaction; nothing is ever partially applied (FR-010). */
  dispatch(cmd: Command, env: DispatchEnv): Result<DispatchOutcome, Rejection> {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before dispatch()');
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const decision = decide(this.#snapshotFor(cmd), cmd, env.now);
      if (!decision.ok) {
        this.raw.exec('ROLLBACK');
        return err(decision.error);
      }
      applyChanges(this.raw, decision.value.changes, deviceId, env.wallMs, env.newOpId);
      this.raw.exec('COMMIT');
      return ok({ offerFinish: decision.value.offerFinish });
    } catch (e) {
      rollbackQuietly(this.raw, 'ROLLBACK');
      throw e;
    }
  }
}
export { rowToArticle } from './queries.ts';
export type { ArticleCursor } from './queries.ts';
export type { BookCard, BookEventView, BookView, DuplicateBookView, DuplicatePairView, HomeView, LibraryView, StragglerView } from './queries.ts';
