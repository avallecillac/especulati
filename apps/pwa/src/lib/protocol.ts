import type { Command, Rejection, StatsView } from '@readerlog/core';
import type { BookCard, BookView, HomeView, LibraryView } from '@readerlog/db';

/** UI ↔ DB worker messages (contracts/worker-api.md). */
export type Query =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'book'; itemId: string }
  | { name: 'stats'; year: number; today: string }
  | { name: 'storage' }
  | { name: 'findByIsbn'; isbn: string }
  | { name: 'pendingDetails' }
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
  cover: Blob | null;
  setting: string | null;
}

export type Request =
  | { id: number; kind: 'dispatch'; cmd: Command }
  | { id: number; kind: 'query'; q: Query }
  | { id: number; kind: 'setMeta'; key: string; value: string }
  | { id: number; kind: 'storeCover'; itemId: string; image: Blob };

export type ClientError = Rejection | { kind: 'Storage'; message: string } | { kind: 'Busy' };

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError };

export type Control = { kind: 'visibility'; visible: boolean };

export const CHANNEL = 'readerlog';
