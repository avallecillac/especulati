import { err, ok, type Result } from '@readerlog/core';
import type { ScanIn, ScanOut } from './protocol.ts';

const FRAME_INTERVAL_MS = 166; // about 6 fps

/** The one place the worker is created, so Vite bundles it (and its WASM) as a separate chunk. */
export function createScannerWorker(): Worker {
  return new Worker(new URL('./scanner.worker.ts', import.meta.url), { type: 'module' });
}

export async function startCamera(video: HTMLVideoElement): Promise<Result<MediaStream, 'denied' | 'unavailable'>> {
  if (!navigator.mediaDevices?.getUserMedia) return err('unavailable');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    return err(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
  }
  try {
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
  } catch {
    stopCamera(stream, video);
    return err('unavailable');
  }
  return ok(stream);
}

/** Stop every track so the camera indicator turns off (FR-014). */
export function stopCamera(stream: MediaStream, video?: HTMLVideoElement): void {
  for (const track of stream.getTracks()) track.stop();
  if (video && video.srcObject === stream) video.srcObject = null;
}

/**
 * Send center-crop frames to the worker, one in flight at a time, about 6 per second.
 * Calls `onIsbn` once with the first ISBN and stops. Returns a stop function.
 */
export function scanFrames(video: HTMLVideoElement, worker: Worker, onIsbn: (isbn: string) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    worker.removeEventListener('message', onMessage);
    video.removeEventListener('loadedmetadata', schedule);
  };

  const schedule = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void sendFrame(), FRAME_INTERVAL_MS);
  };

  const onMessage = (ev: MessageEvent<ScanOut>) => {
    const m = ev.data;
    if (m.kind === 'isbn') {
      stop();
      onIsbn(m.isbn);
    } else if (m.kind === 'none' || m.kind === 'error') {
      schedule();
    }
    // 'ready' needs no action: the frame that triggered it is still in flight.
  };

  async function sendFrame(): Promise<void> {
    if (stopped) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h || video.readyState < 2) {
      video.addEventListener('loadedmetadata', schedule, { once: true });
      schedule();
      return;
    }
    const sw = Math.round(w * 0.8);
    const sh = Math.round(h * 0.5);
    try {
      const bitmap = await createImageBitmap(video, Math.round((w - sw) / 2), Math.round((h - sh) / 2), sw, sh);
      if (stopped) {
        bitmap.close();
        return;
      }
      const msg: ScanIn = { kind: 'frame', bitmap };
      worker.postMessage(msg, [bitmap]);
    } catch {
      schedule();
    }
  }

  worker.addEventListener('message', onMessage);
  schedule();
  return stop;
}
