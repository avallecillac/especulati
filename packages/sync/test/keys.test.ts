import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatSyncCode } from '../src/code.ts';
import { deriveKeys } from '../src/keys.ts';

const k = Uint8Array.from({ length: 32 }, (_, i) => i);
const hk = (info: string, len: number) =>
  Buffer.from(hkdfSync('sha256', k, 'readerlog-sync-v1', info, len));

// Recorded once; they change only with a new version prefix.
const SPACE_ID = '91488ff10bdb42384315ee164e88b9e9';
const AUTH_TOKEN = 'PoJYQorPKcAXueDTeI0kWRKO9beMVMH9nQiaydNrLVY';
const CODE = '000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFP-63ED';

describe('deriveKeys', () => {
  it('matches independent node:crypto HKDF', async () => {
    const keys = await deriveKeys(k);
    expect(keys.spaceId).toBe(hk('space-id', 16).toString('hex'));
    expect(keys.authToken).toBe(hk('auth', 32).toString('base64url'));
  });

  it('matches the recorded test vectors', async () => {
    const keys = await deriveKeys(k);
    expect(keys.spaceId).toBe(SPACE_ID);
    expect(keys.authToken).toBe(AUTH_TOKEN);
    expect(formatSyncCode(k)).toBe(CODE);
  });

  it('spaceId is 32 lowercase hex chars', async () => {
    expect((await deriveKeys(k)).spaceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('encKey is a non-extractable AES-GCM-256 key', async () => {
    const { encKey } = await deriveKeys(k);
    expect(encKey.extractable).toBe(false);
    expect(encKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...encKey.usages].sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', encKey)).rejects.toThrow();
  });

  it('different secrets give different ids', async () => {
    const k2 = k.slice();
    k2[0] = 9;
    expect((await deriveKeys(k2)).spaceId).not.toBe((await deriveKeys(k)).spaceId);
  });
});
