<script lang="ts">
  import { onMount } from 'svelte';
  import { createScannerWorker, scanFrames, startCamera, stopCamera } from '../scanner/camera.ts';

  /** Reads a sync-code QR and hands its text to `onscanned`; `oncancel` returns to typing the code. */
  let { onscanned, oncancel }: { onscanned: (text: string) => void; oncancel: () => void } = $props();

  let video = $state<HTMLVideoElement>();
  let problem = $state<'denied' | 'unavailable' | null>(null);

  let stream: MediaStream | null = null;
  let worker: Worker | null = null;
  let stopScan: (() => void) | null = null;
  let destroyed = false;
  let generation = 0;

  function stop(): void {
    generation++;
    stopScan?.();
    stopScan = null;
    if (stream) {
      stopCamera(stream, video);
      stream = null;
    }
  }

  async function start(): Promise<void> {
    if (!video || stream || destroyed) return;
    const mine = ++generation;
    const r = await startCamera(video);
    if (!r.ok) {
      if (mine === generation && !destroyed) problem = r.error;
      return;
    }
    if (mine !== generation || destroyed) {
      stopCamera(r.stream, video);
      return;
    }
    stream = r.stream;
    problem = null;
    // The scanner worker (and its WASM) is only created here, when the scanner opens.
    worker ??= createScannerWorker();
    stopScan = scanFrames(video, worker, (text) => {
      navigator.vibrate?.(40);
      stop();
      onscanned(text);
    });
  }

  const onHidden = () => {
    if (document.visibilityState === 'hidden') stop();
    else if (!problem) void start();
  };

  onMount(() => {
    void start();
    return () => {
      destroyed = true;
      stop();
      worker?.terminate();
      worker = null;
    };
  });
</script>

<svelte:document onvisibilitychange={onHidden} />

<h2>Scan sync code</h2>
{#if problem}
  <p role="alert">{problem === 'denied' ? 'Camera permission was denied.' : 'No camera is available.'}</p>
  <button class="primary" type="button" onclick={oncancel}>Type the code instead</button>
{:else}
  <div class="scan-view">
    <video bind:this={video} playsinline muted></video>
  </div>
  <p class="muted">Point the camera at the QR code on your partner's phone.</p>
  <button type="button" onclick={oncancel}>Cancel</button>
{/if}
