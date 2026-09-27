import type { Command, Rejection } from '@readerlog/core';
import type { BookView, HomeView, LibraryView } from '@readerlog/db';

/** UI ↔ DB worker messages (contracts/worker-api.md). */
export type Query =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'book'; itemId: string }
  | { name: 'storage' };

export interface StorageInfo {
  persisted: boolean | null;
  deviceId: string;
  schemaVersion: number;
}

export interface QueryResult {
  home: HomeView;
  library: LibraryView;
  book: BookView | null;
  storage: StorageInfo;
}

export type Request =
  | { id: number; kind: 'dispatch'; cmd: Command }
  | { id: number; kind: 'query'; q: Query }
  | { id: number; kind: 'setMeta'; key: string; value: string };

export type ClientError = Rejection | { kind: 'Storage'; message: string } | { kind: 'Busy' };

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError };

export type Control = { kind: 'visibility'; visible: boolean };

export const CHANNEL = 'readerlog';
