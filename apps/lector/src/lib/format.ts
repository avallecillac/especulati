import type { BookCard } from '@especulati/lector-db';
import type { BookStatus } from '@especulati/lector-core';

export const STATUS_LABEL: Record<BookStatus, string> = {
  queued: 'Queued',
  reading: 'Reading',
  finished: 'Finished',
  abandoned: 'Abandoned',
};

export function progressLabel(c: BookCard): string {
  if (c.lastPage === null) return c.totalPages ? `${c.totalPages} pages` : 'No page logged yet';
  return c.totalPages ? `p. ${c.lastPage} / ${c.totalPages}` : `p. ${c.lastPage}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
