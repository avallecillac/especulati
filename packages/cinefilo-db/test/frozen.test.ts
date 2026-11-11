// Guard for Cinéfilo's frozen sync identifiers (openspec add-cinefilo D9). If one fails, a string
// exchanged between devices changed: revert the change, do not update the expectation. The lector values are
// spelled out as literals on purpose: cinefilo must not import lector.
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveKeys, open, parseQrPayload, qrPayload, seal, type Envelope, type Plain } from '@especulati/sync';
import { cinefiloSyncApp, ENVELOPE_AAD_PREFIX, QR_PREFIX, SYNC_SALT } from '../src/index.ts';

const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
const BATCH_ID = 'b0000000-0000-4000-8000-000000000001';
const PLAIN: Plain = { v: 1, device: 'dev-1', ops: [] };

describe('frozen sync identifiers', () => {
  it('carries the literals', () => {
    expect(SYNC_SALT).toBe('cinefilo-sync-v1');
    expect(ENVELOPE_AAD_PREFIX).toBe('cinefilo/v1');
    expect(QR_PREFIX).toBe('cinefilo:sync:1:');
    expect(cinefiloSyncApp.salt).toBe('cinefilo-sync-v1');
    expect(cinefiloSyncApp.aadPrefix).toBe('cinefilo/v1');
    expect(cinefiloSyncApp.qrPrefix).toBe('cinefilo:sync:1:');
  });

  it('differs from lector (literal values) so the two spaces, ciphertexts and codes never mix', () => {
    expect(SYNC_SALT).not.toBe('readerlog-sync-v1');
    expect(ENVELOPE_AAD_PREFIX).not.toBe('readerlog/v1');
    expect(QR_PREFIX).not.toBe('readerlog:sync:1:');
  });

  it('the salt derives the recorded spaceId and authToken', async () => {
    const keys = await deriveKeys(secret, SYNC_SALT);
    const hk = (info: string, len: number) => Buffer.from(hkdfSync('sha256', secret, 'cinefilo-sync-v1', info, len));
    expect(keys.spaceId).toBe(hk('space-id', 16).toString('hex'));
    expect(keys.authToken).toBe(hk('auth', 32).toString('base64url'));
    const lector = await deriveKeys(secret, 'readerlog-sync-v1');
    expect(keys.spaceId).not.toBe(lector.spaceId);
  });

  it('the AAD is `cinefilo/v1/<spaceId>/<batchId>`, and a lector-prefixed open fails', async () => {
    const { encKey, spaceId } = await deriveKeys(secret, SYNC_SALT);
    const e: Envelope = await seal(PLAIN, encKey, spaceId, BATCH_ID, ENVELOPE_AAD_PREFIX);
    const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64url'));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(e.iv), additionalData: new TextEncoder().encode(`cinefilo/v1/${spaceId}/${BATCH_ID}`) },
      encKey,
      b64(e.ct),
    );
    expect(pt.byteLength).toBeGreaterThan(1);
    expect(await open(e, encKey, spaceId, ENVELOPE_AAD_PREFIX)).toEqual({ ok: true, value: PLAIN });
    expect((await open(e, encKey, spaceId, 'readerlog/v1')).ok).toBe(false);
  });

  it('the QR text starts with `cinefilo:sync:1:`, parses back, and a lector code is refused', () => {
    expect(qrPayload(secret, QR_PREFIX).startsWith('cinefilo:sync:1:')).toBe(true);
    expect(parseQrPayload(qrPayload(secret, QR_PREFIX), QR_PREFIX)).toEqual({ ok: true, value: secret });
    expect(parseQrPayload(qrPayload(secret, 'readerlog:sync:1:'), QR_PREFIX).ok).toBe(false);
  });
});
