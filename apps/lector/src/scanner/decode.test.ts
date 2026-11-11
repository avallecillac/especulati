import { describe, expect, it } from 'vitest';
import { readBarcodes, writeBarcode } from 'zxing-wasm/full';
import { isbnFromBarcode } from './isbnFilter.ts';

// Validates the reader option set used by scanner.worker.ts (the worker itself is covered by e2e).
const options = { formats: ['EAN13' as const], tryHarder: true, maxNumberOfSymbols: 1 };

describe('zxing EAN-13 round trip', () => {
  it('decodes a generated barcode to an ISBN', async () => {
    const { image } = await writeBarcode('9780441172719', { format: 'EAN13' });
    expect(image).not.toBeNull();
    const results = await readBarcodes(image!, options);
    expect(results).toHaveLength(1);
    expect(isbnFromBarcode(results[0]!.text)).toBe('9780441172719');
  });
});
