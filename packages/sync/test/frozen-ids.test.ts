// Guard for the storage/wire identifiers frozen by openspec rename-to-lector (design D1).
// If one of these fails, a string that was persisted or exchanged between devices has changed:
// revert the change, do not update the expectation.
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseQrPayload, qrPayload } from '../src/code.ts';
import { open, seal, type Envelope, type Plain } from '../src/envelope.ts';
import {
  CAPTURE_ID_LABEL,
  ENVELOPE_AAD_PREFIX,
  HIGHLIGHT_ID_LABEL,
  ITEM_TAG_ID_LABEL,
  QR_PREFIX,
  SYNC_SALT,
  TAG_ID_LABEL,
} from '../src/frozen.ts';
import { deriveKeys } from '../src/keys.ts';
import { uuidFromHash } from '../src/ids.ts';

const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
const SPACE_ID = '91488ff10bdb42384315ee164e88b9e9';
const AUTH_TOKEN = 'PoJYQorPKcAXueDTeI0kWRKO9beMVMH9nQiaydNrLVY';
const BATCH_ID = 'b0000000-0000-4000-8000-000000000001';
const PLAIN: Plain = { v: 1, device: 'dev-1', ops: [] };

// Sealed once with the pre-rename build: key = deriveKeys(secret), spaceId and batchId as above,
// AAD = `readerlog/v1/${spaceId}/${batchId}`. It must keep opening.
const FIXTURE: Envelope = {
  batchId: BATCH_ID,
  iv: 'PNilZTvcRua5hXHB',
  ct: 'P-emTUMIxGDDwjkAG4aRTn-wpOGkIiKTzvwu_epO1lHo-LV7VYPRGR28IGNUykV9LCysfC7eGBmVfW56P8CIHsa0tA',
};

describe('frozen sync identifiers', () => {
  it('the literals are unchanged', () => {
    expect(SYNC_SALT).toBe('readerlog-sync-v1');
    expect(ENVELOPE_AAD_PREFIX).toBe('readerlog/v1');
    expect(QR_PREFIX).toBe('readerlog:sync:1:');
    expect(TAG_ID_LABEL).toBe('readerlog-tag-v1');
    expect(ITEM_TAG_ID_LABEL).toBe('readerlog-item-tag-v1');
    expect(CAPTURE_ID_LABEL).toBe('readerlog-capture-v1');
    expect(HIGHLIGHT_ID_LABEL).toBe('readerlog-highlight-v1');
  });

  it('the HKDF salt derives the recorded spaceId and authToken', async () => {
    const keys = await deriveKeys(secret);
    expect(keys.spaceId).toBe(SPACE_ID);
    expect(keys.authToken).toBe(AUTH_TOKEN);
    const hk = (info: string, len: number) => Buffer.from(hkdfSync('sha256', secret, 'readerlog-sync-v1', info, len));
    expect(keys.spaceId).toBe(hk('space-id', 16).toString('hex'));
    expect(keys.authToken).toBe(hk('auth', 32).toString('base64url'));
  });

  it('a fixture ciphertext from the pre-rename build still opens', async () => {
    const { encKey, spaceId } = await deriveKeys(secret);
    const r = await open(FIXTURE, encKey, spaceId);
    expect(r).toEqual({ ok: true, value: PLAIN });
  });

  it('the AAD is `readerlog/v1/<spaceId>/<batchId>`', async () => {
    const { encKey, spaceId } = await deriveKeys(secret);
    const e = await seal(PLAIN, encKey, spaceId, BATCH_ID);
    // Decrypt independently with the literal AAD; a different AAD would fail authentication.
    const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64url'));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(e.iv), additionalData: new TextEncoder().encode(`readerlog/v1/${SPACE_ID}/${BATCH_ID}`) },
      encKey,
      b64(e.ct),
    );
    expect(pt.byteLength).toBeGreaterThan(1);
    expect(await open(e, encKey, spaceId)).toEqual({ ok: true, value: PLAIN });
  });

  it('the QR text starts with `readerlog:sync:1:` and the code parses back', () => {
    expect(qrPayload(secret).startsWith('readerlog:sync:1:')).toBe(true);
    expect(parseQrPayload(qrPayload(secret))).toEqual({ ok: true, value: secret });
  });

  it('the capture-peer hash labels derive the recorded ids', async () => {
    const same = async (label: string, built: string) => expect(await uuidFromHash(label)).toBe(await uuidFromHash(built));
    await same(`${TAG_ID_LABEL}|k`, 'readerlog-tag-v1|k');
    await same(`${ITEM_TAG_ID_LABEL}|i|t`, 'readerlog-item-tag-v1|i|t');
    await same(`${CAPTURE_ID_LABEL}|u|a`, 'readerlog-capture-v1|u|a');
    await same(`${HIGHLIGHT_ID_LABEL}|u|a`, 'readerlog-highlight-v1|u|a');
  });
});
