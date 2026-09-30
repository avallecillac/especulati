// Deterministic ids (004 research R8, 005 research R5). Core has no crypto, so the shell hashes;
// decide() only checks the result is a well-formed UUID. No imports: shared by the engine side
// and the capture peer.

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
