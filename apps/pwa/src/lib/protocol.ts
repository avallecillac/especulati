import type { Command, Rejection, Result, StatsView } from '@readerlog/core';
import type { BookCard, BookView, DuplicatePairView, HomeView, LibraryView, StragglerView } from '@readerlog/db';
import type { SyncError, SyncReason, SyncRunResult, SyncStatusView } from '@readerlog/sync';

/** UI ↔ DB worker messages (contracts/worker-api.md). */
export type Query =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'book'; itemId: string }
  | { name: 'stats'; year: number; today: string }
  | { name: 'storage' }
  | { name: 'findByIsbn'; isbn: string }
  | { name: 'pendingDetails' }
  | { name: 'missingCovers' }
  | { name: 'duplicates' }
  | { name: 'stragglers' }
  | { name: 'cover'; itemId: string }
  | { name: 'setting'; key: 'google_books_api_key' };

export interface StorageInfo {
  persisted: boolean | null;
  deviceId: string;
  schemaVersion: number;
  covers: { count: number; bytes: number };
}

export interface QueryResult {
  home: HomeView;
  library: LibraryView;
  book: BookView | null;
  stats: StatsView;
  storage: StorageInfo;
  findByIsbn: BookCard | null;
  pendingDetails: { itemId: string; isbn: string }[];
  missingCovers: { itemId: string; coverUrl: string }[];
  duplicates: DuplicatePairView[];
  stragglers: StragglerView[];
  cover: Blob | null;
  setting: string | null;
}

export type Request =
  | { id: number; kind: 'dispatch'; cmd: Command }
  | { id: number; kind: 'query'; q: Query }
  | { id: number; kind: 'setMeta'; key: string; value: string }
  | { id: number; kind: 'storeCover'; itemId: string; image: Blob }
  | { id: number; kind: 'sync'; op: SyncOp };

/** Sync requests (contracts/worker-api-004.md). The code text crosses only for turnOn, join and showCode. */
export type SyncOp =
  | { action: 'run'; reason: SyncReason }
  | { action: 'status' }
  | { action: 'turnOn' }
  | { action: 'join'; code: string }
  | { action: 'showCode' }
  | { action: 'leave' }
  | { action: 'reset' };

export interface SyncCode {
  code: string;
  /** The QR payload. The main thread renders it. */
  qr: string;
}

export interface SyncResult {
  run: SyncRunResult;
  status: SyncStatusView;
  turnOn: Result<SyncCode, SyncError>;
  join: Result<{ duplicates: number }, SyncError>;
  showCode: SyncCode | null;
  leave: null;
  reset: Result<SyncCode, SyncError>;
}

export type ClientError = Rejection | { kind: 'Storage'; message: string } | { kind: 'Busy' };

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError };

export type Control = { kind: 'visibility'; visible: boolean };

export const CHANNEL = 'readerlog';
