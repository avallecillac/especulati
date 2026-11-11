// Deterministic ids for merge copies and dismissals (004 research R8, FR-029). Two devices that
// run the same merge derive the same ids, so their inserts collapse to one under field LWW.
// Core has no crypto, so the shell hashes; decide() only checks the result is a well-formed UUID.

import { uuidFromHash } from '@readerlog/sync';
import { DISMISSAL_LABEL, MERGE_COPY_LABEL } from './frozen.ts';

export { uuidFromHash };

/** Content-addressed (v2): the same entry copied onto the same book by any path gets the same id. */
export const mergeCopyId = (
  survivorId: string,
  e: { type: string; page: number | null; occurredAt: string; localDate: string },
): Promise<string> => uuidFromHash(`${MERGE_COPY_LABEL}|${survivorId}|${e.type}|${e.page ?? ''}|${e.occurredAt}|${e.localDate}`);

export const dismissalId = (a: string, b: string): Promise<string> =>
  uuidFromHash(`${DISMISSAL_LABEL}|${a < b ? a : b}|${a < b ? b : a}`);
