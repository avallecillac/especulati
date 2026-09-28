import type { Isbn13 } from '@readerlog/core';

export type Fetch = typeof fetch;

export interface BookDetails {
  title: string | null;
  authors: string[];
  totalPages: number | null;
  genre: string | null;
  coverUrl: string | null;
  firstPublishYear: number | null;
  source: 'openlibrary' | 'googlebooks';
}

/** What a single catalog response contributes, before merging. */
export type PartialDetails = Omit<BookDetails, 'source'>;

export type LookupOutcome =
  | { kind: 'found'; details: BookDetails }
  | { kind: 'notFound' }
  | { kind: 'unavailable'; reason: 'offline' | 'network' | 'http'; status?: number }
  | { kind: 'timeout' };

export interface LookupDeps {
  fetch: Fetch;
  online: () => boolean;
  timeoutMs?: number;
}

export type { Isbn13 };

/** Research R11: a catalog page count is used only if it is an integer 1..10000. */
export function validPages(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10000 ? n : null;
}

export type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;
export const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
