import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatSyncCode, qrPayload } from '../src/code.ts';
import { seal, type Plain } from '../src/envelope.ts';
import { deriveKeys } from '../src/keys.ts';

// Golden vectors recorded from the code before extract-shared-sync. They pin the frozen wire
// values (salt, AAD prefix, QR prefix): the refactor must reproduce them byte for byte.
const k = Uint8Array.from({ length: 32 }, (_, i) => i);
const FIXED_IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const BATCH_ID = '00000000-0000-4000-8000-0000000000b1';
const PLAIN: Plain = {
  v: 1,
  device: '00000000-0000-4000-8000-0000000000d1',
  ops: [
    {
      op: '00000000-0000-4000-8000-0000000000e1',
      hlc: '1790000000000-0000-00000000-0000-4000-8000-0000000000d1',
      tbl: 'items',
      row: '00000000-0000-4000-8000-0000000000f1',
      fields: { type: 'book', title: 'Golden', total_pages: 100, deleted_at: null },
    },
  ],
};

const SPACE_ID = '91488ff10bdb42384315ee164e88b9e9';
const AUTH_TOKEN = 'PoJYQorPKcAXueDTeI0kWRKO9beMVMH9nQiaydNrLVY';
const CODE = '000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFP-63ED';
const QR = 'readerlog:sync:1:000G40R40M30E209185GR38E1W8124GK2GAHC5RR34D1P70X3RFP63ED';
const CT = 'mM1nu5Ef_N51ZhaZM_4k9UMDFFH7ByhdcmtnwH2acjtTcC-_eJ1QWzXKmBCbCemifAGlolz9iHGuihSSlrUPYnQBLFPIkhhC9c5cdj3ITddSJKI5yLjfE-VjSkWReKLoAR0KEaF4Gu3GfpQPxo2SLpEVvHJL4O-A0GLA8pYZ89Lz6Dog9yXg-8AWFP9HXNcUh-jqHwklOb9LosTtFQtXi4IUlnlIX4mlHuFgFBCB7-DfH2GgrqKG';
const IV = 'oKGio6Slpqeoqaqr';

afterEach(() => vi.restoreAllMocks());

describe('golden vectors', () => {
  it('deriveKeys: spaceId and authToken', async () => {
    const keys = await deriveKeys(k);
    expect(keys.spaceId).toBe(SPACE_ID);
    expect(keys.authToken).toBe(AUTH_TOKEN);
  });

  it('seal: exact ciphertext for a fixed key, IV, batch id and plaintext', async () => {
    const { spaceId, encKey } = await deriveKeys(k);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: Uint8Array) => {
      a.set(FIXED_IV);
      return a;
    }) as typeof crypto.getRandomValues);
    const env = await seal(PLAIN, encKey, spaceId, BATCH_ID);
    expect(env).toEqual({ batchId: BATCH_ID, iv: IV, ct: CT });
  });

  it('formatSyncCode and qrPayload: exact strings', () => {
    expect(formatSyncCode(k)).toBe(CODE);
    expect(qrPayload(k)).toBe(QR);
  });
});
