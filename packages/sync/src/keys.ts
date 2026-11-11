import { SYNC_SALT } from './frozen.ts';

const SALT = new TextEncoder().encode(SYNC_SALT);

export interface SyncKeys {
  spaceId: string;
  authToken: string;
  encKey: CryptoKey;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** HKDF-SHA-256 of the sync secret into the three values of research R2. */
export async function deriveKeys(k: Uint8Array): Promise<SyncKeys> {
  const base = await crypto.subtle.importKey('raw', k.slice(), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const bits = async (info: string, bytes: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: new TextEncoder().encode(info) },
        base,
        bytes * 8,
      ),
    );
  const spaceId = Array.from(await bits('space-id', 16), (b) => b.toString(16).padStart(2, '0')).join('');
  const authToken = b64url(await bits('auth', 32));
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: new TextEncoder().encode('enc') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { spaceId, authToken, encKey };
}
