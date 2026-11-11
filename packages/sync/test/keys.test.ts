import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.ts';

const SALT = 'toy-sync-v1';
const k = Uint8Array.from({ length: 32 }, (_, i) => i);
const hk = (info: string, len: number) =>
  Buffer.from(hkdfSync('sha256', k, SALT, info, len));

describe('deriveKeys', () => {
  it('matches independent node:crypto HKDF', async () => {
    const keys = await deriveKeys(k, SALT);
    expect(keys.spaceId).toBe(hk('space-id', 16).toString('hex'));
    expect(keys.authToken).toBe(hk('auth', 32).toString('base64url'));
  });

  it('different salts give different spaces, auth tokens and keys (apps cannot share a space)', async () => {
    const a = await deriveKeys(k, SALT);
    const b = await deriveKeys(k, 'other-sync-v1');
    expect(b.spaceId).not.toBe(a.spaceId);
    expect(b.authToken).not.toBe(a.authToken);
  });

  it('spaceId is 32 lowercase hex chars', async () => {
    expect((await deriveKeys(k, SALT)).spaceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('encKey is a non-extractable AES-GCM-256 key', async () => {
    const { encKey } = await deriveKeys(k, SALT);
    expect(encKey.extractable).toBe(false);
    expect(encKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...encKey.usages].sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', encKey)).rejects.toThrow();
  });

  it('different secrets give different ids', async () => {
    const k2 = k.slice();
    k2[0] = 9;
    expect((await deriveKeys(k2, SALT)).spaceId).not.toBe((await deriveKeys(k, SALT)).spaceId);
  });
});
