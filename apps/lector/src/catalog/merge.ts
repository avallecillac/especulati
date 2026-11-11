import type { BookDetails, PartialDetails } from './types.ts';

/** "A", "A & B", "A, B & C"; empty → null. */
export function authorsLabel(authors: string[]): string | null {
  if (authors.length === 0) return null;
  if (authors.length === 1) return authors[0]!;
  return `${authors.slice(0, -1).join(', ')} & ${authors[authors.length - 1]}`;
}

export interface MergeInput {
  search: PartialDetails | null; // #1
  edition: { totalPages: number | null; coverUrl: string | null } | null; // #2
  google: PartialDetails | null; // #3
}

/** Contract merge rules 1-4. Requires `search` or `google` to be non-null. */
export function mergeDetails({ search, edition, google }: MergeInput): BookDetails {
  const primary = search ?? google;
  return {
    title: primary?.title ?? null,
    authors: primary?.authors ?? [],
    totalPages: edition?.totalPages ?? search?.totalPages ?? google?.totalPages ?? null,
    genre: search?.genre ?? google?.genre ?? null,
    coverUrl: edition?.coverUrl ?? search?.coverUrl ?? google?.coverUrl ?? null,
    firstPublishYear: search?.firstPublishYear ?? null,
    source: search ? 'openlibrary' : 'googlebooks',
  };
}
