import type { RemoteOp, OpWire } from './merge.ts';

export type SyncProblem = 'offline' | 'relay' | 'spaceGone' | 'unauthorized' | 'newerVersion' | 'corrupt';

export interface SyncStatus {
  lastOkAt: string | null;
  problem: SyncProblem | null;
  undecryptable: number;
}

export interface SyncMeta {
  /** The 32-byte sync code, base64url. null means sync is off. */
  key: string | null;
  /** The last applied relay seq. */
  cursor: number;
  pendingBatch: { batchId: string; maxSeq: number } | null;
  status: SyncStatus | null;
  /** The old space's sync code (base64url) while its DELETE after a reset is still owed: deleting needs the old token. */
  oldSpace: string | null;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  parked: number;
}

/**
 * What the sync engine needs from local storage. db-kit implements it over SQLite; the engine
 * depends on this interface only, so it carries no SQLite and no app domain.
 */
export interface SyncStore {
  syncMeta(): SyncMeta;
  setSyncMeta(patch: Partial<Omit<SyncMeta, 'cursor'>> & { cursor?: number | null }): void;
  getMeta(key: string): string | null;
  inboxOpIds(): string[];
  applyPulledPage(ops: readonly RemoteOp[], cursor: number, wallMs: () => number): ApplyResult;
  unpushedOps(limit: number, upToSeq?: number): { maxSeq: number; ops: OpWire[] };
  completePush(maxSeq: number): void;
  resetPushState(): void;
  pendingCount(): number;
}
