// Deterministic ids for merge copies and dismissals (004 research R8, FR-029). Two devices that
// run the same merge derive the same ids, so their inserts collapse to one under field LWW.
// Core has no crypto, so the shell hashes; decide() only checks the result is a well-formed UUID.

const hex = (b: number) => b.toString(16).padStart(2, '0');

/** SHA-256 of `label`, first 16 bytes, version-4 / variant bits set, as a lowercase UUID. */
export async function uuidFromHash(label: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label)));
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Content-addressed (v2): the same entry copied onto the same book by any path gets the same id. */
export const mergeCopyId = (
  survivorId: string,
  e: { type: string; page: number | null; occurredAt: string; localDate: string },
): Promise<string> => uuidFromHash(`readerlog-merge-v2|${survivorId}|${e.type}|${e.page ?? ''}|${e.occurredAt}|${e.localDate}`);

export const dismissalId = (a: string, b: string): Promise<string> =>
  uuidFromHash(`readerlog-dismiss-v1|${a < b ? a : b}|${a < b ? b : a}`);
