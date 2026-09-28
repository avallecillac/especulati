import type { BookDetails } from '../catalog/types.ts';

export interface Draft {
  source: 'scan' | 'isbn' | 'search' | 'manual';
  isbn: string | null;
  lookup: 'idle' | 'running' | 'found' | 'notFound' | 'unavailable' | 'timeout';
  details: BookDetails | null;
  /** Set when the user chose "Add another copy" past the duplicate check. */
  allowDuplicate?: boolean;
}

/** The confirmation draft: what a scan, ISBN or search produced, before the user saves it. */
export const draft = $state<{ current: Draft | null }>({ current: null });

export function clearDraft(): void {
  draft.current = null;
}
