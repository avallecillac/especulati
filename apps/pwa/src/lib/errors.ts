import type { ClientError } from './protocol.ts';
import { showToast } from './toast.svelte.ts';

/** Inline, specific messages for rejections (FR-014). */
export function errorMessage(e: ClientError): string {
  switch (e.kind) {
    case 'TitleRequired':
      return 'Title is required.';
    case 'InvalidPageCount':
      return 'Total pages must be a whole number above 0.';
    case 'InvalidPage':
      return 'Page must be a whole number above 0.';
    case 'PageBeyondEnd':
      return `Page can't be more than the book's ${e.totalPages} pages.`;
    case 'PageNotAllowed':
      return 'Only progress entries can have a page.';
    case 'PagesBelowLogged':
      return `You've already logged page ${e.maxLogged}; total pages can't be lower.`;
    case 'InvalidTransition':
      return `Can't mark a ${e.from} book as ${e.type}.`;
    case 'NotFound':
      return 'That book or entry no longer exists.';
    case 'AlreadyExists':
      return 'That was already saved.';
    case 'InvalidInput':
      return `Invalid ${e.field}: ${e.reason}.`;
    case 'Storage':
      return `Couldn't save — device storage failed (${e.message}). Nothing was changed.`;
    case 'Busy':
      return 'Readerlog is open in another window. Close it or switch to it.';
  }
}

/** Toast an error. Busy is shown once, as the app-level banner, not per screen. */
export function reportError(e: ClientError): void {
  if (e.kind !== 'Busy') showToast(errorMessage(e), { kind: 'error' });
}
