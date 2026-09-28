/// <reference lib="webworker" />
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { isbnFromBarcode } from './isbnFilter.ts';
import type { ScanIn, ScanOut } from './protocol.ts';

/** Decodes EAN-13 barcodes off the main thread (research R3). Self-hosted WASM, prepared lazily. */
const post = (m: ScanOut) => self.postMessage(m);
let prepared: Promise<unknown> | null = null;
let canvas: OffscreenCanvas | null = null;

function prepare(): Promise<unknown> {
  prepared ??= prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: true,
  }).then(() => post({ kind: 'ready' }));
  return prepared;
}

async function handle(bitmap: ImageBitmap): Promise<void> {
  try {
    await prepare();
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const results = await readBarcodes(imageData, { formats: ['EAN13'], tryHarder: true, maxNumberOfSymbols: 1 });
    const isbn = results.map((r) => isbnFromBarcode(r.text)).find((x) => x !== null) ?? null;
    post(isbn ? { kind: 'isbn', isbn } : { kind: 'none' });
  } catch (e) {
    prepared = null; // allow a retry on the next frame
    post({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (ev: MessageEvent<ScanIn>) => {
  if (ev.data.kind === 'frame') void handle(ev.data.bitmap);
};
