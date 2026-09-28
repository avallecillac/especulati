import type { Database } from '@sqlite.org/sqlite-wasm';
import { decide, err, ok, type Command, type DeviceId, type Instant, type Rejection, type Result } from '@readerlog/core';
import { applyChanges, readMeta, rollbackQuietly, writeMeta } from './apply.ts';
import { migrate } from './migrations.ts';
import { loadBookSnapshot } from './snapshot.ts';
import { deleteCover, getCover, putCover } from './covers.ts';
import { bookView, findByIsbn, homeView, pendingDetails, libraryView, type BookCard, type BookView, type HomeView, type LibraryView } from './queries.ts';

export { applyChanges, readMeta, writeMeta } from './apply.ts';
export { migrate, SCHEMA_VERSION } from './migrations.ts';
export { loadBookSnapshot } from './snapshot.ts';

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

  home(): HomeView {
    return homeView(this.raw);
  }

  library(): LibraryView {
    return libraryView(this.raw);
  }

  book(itemId: string): BookView | null {
    return bookView(this.raw, itemId);
  }

  findByIsbn(isbn: string): BookCard | null {
    return findByIsbn(this.raw, isbn);
  }

  pendingDetails(): { itemId: string; isbn: string }[] {
    return pendingDetails(this.raw);
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

  /** Read → decide → apply in one transaction; nothing is ever partially applied (FR-010). */
  dispatch(cmd: Command, env: DispatchEnv): Result<DispatchOutcome, Rejection> {
    const deviceId = this.#deviceId;
    if (!deviceId) throw new Error('ensureDeviceId() must run before dispatch()');
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const decision = decide(loadBookSnapshot(this.raw, cmd.itemId), cmd, env.now);
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
export type { BookCard, BookEventView, BookView, HomeView, LibraryView } from './queries.ts';
