import { describe, expect, it } from 'vitest';
import { readBarcodes, writeBarcode } from 'zxing-wasm/full';
import { QR_PREFIX } from '@especulati/cinefilo-db';
import { formatSyncCode, parseQrPayload, parseSyncCode, qrPayload } from '@especulati/sync';
import { QR_READ_OPTIONS } from './decode.ts';

// Validates the reader option set used by scanner.worker.ts (the worker itself is covered by e2e).
describe('zxing QR round trip', () => {
  it('decodes a generated cinefilo sync-code QR and parses it with the QR prefix', async () => {
    const secret = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
    const payload = qrPayload(secret, QR_PREFIX);
    expect(payload.startsWith(QR_PREFIX)).toBe(true);
    const { image } = await writeBarcode(payload, { format: 'QRCode', scale: 4 });
    expect(image).not.toBeNull();
    const results = await readBarcodes(image!, QR_READ_OPTIONS);
    expect(results).toHaveLength(1);
    const parsed = parseQrPayload(results[0]!.text, QR_PREFIX);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(secret);
    expect(parseSyncCode(formatSyncCode(parsed.value)).ok).toBe(true);
  });

  it('a QR with another prefix is not a cinefilo code', async () => {
    const { image } = await writeBarcode('readerlog:sync:1:AAAA', { format: 'QRCode', scale: 4 });
    const results = await readBarcodes(image!, QR_READ_OPTIONS);
    expect(parseQrPayload(results[0]!.text, QR_PREFIX).ok).toBe(false);
  });
});
