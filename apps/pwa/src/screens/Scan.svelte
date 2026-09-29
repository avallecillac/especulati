<script lang="ts">
  import { onMount } from 'svelte';
  import type { BookCard } from '@readerlog/db';
  import { createScannerWorker, scanFrames, startCamera, stopCamera } from '../scanner/camera.ts';
  import { startIsbnFlow } from '../lib/isbnFlow.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import DuplicatePrompt from './DuplicatePrompt.svelte';

  /** `qr`: read a sync-code QR and hand its text to `onscanned` (the Sync screen); no ISBN flow. */
  let { mode = 'isbn', onscanned, oncancel: oncancelScan }: { mode?: 'isbn' | 'qr'; onscanned?: (text: string) => void; oncancel?: () => void } = $props();

  const HINT_AFTER_MS = 10_000;

  let video = $state<HTMLVideoElement>();
  let problem = $state<'denied' | 'unavailable' | null>(null);
  let hint = $state(false);
  let flash = $state(false);
  let duplicate = $state<{ isbn: string; existing: BookCard } | null>(null);

  let stream: MediaStream | null = null;
  let worker: Worker | null = null;
  let stopScan: (() => void) | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  // Bumped on every stop so a getUserMedia that resolves late is discarded.
  let generation = 0;

  function stop(): void {
    generation++;
    stopScan?.();
    stopScan = null;
    clearTimeout(hintTimer);
    if (stream) {
      stopCamera(stream, video);
      stream = null;
    }
  }

  async function start(): Promise<void> {
    if (!video || stream || destroyed) return;
    const mine = ++generation;
    hint = false;
    const r = await startCamera(video);
    if (!r.ok) {
      if (mine === generation && !destroyed) problem = r.error;
      return;
    }
    if (mine !== generation || destroyed) {
      stopCamera(r.value, video);
      return;
    }
    stream = r.value;
    problem = null;
    worker ??= createScannerWorker();
    stopScan = scanFrames(video, worker, (text) => void onIsbn(text), mode === 'qr' ? ['QRCode'] : ['EAN13']);
    hintTimer = setTimeout(() => (hint = true), HINT_AFTER_MS);
  }

  async function onIsbn(isbn: string): Promise<void> {
    navigator.vibrate?.(40);
    flash = true;
    setTimeout(() => (flash = false), 250);
    stop();
    if (mode === 'qr') {
      onscanned?.(isbn);
      return;
    }
    const r = await startIsbnFlow(isbn);
    if (r.kind === 'duplicate' && !destroyed) duplicate = { isbn, existing: r.existing };
  }

  const enterIsbn = () => navigate('/isbn');

  const onHidden = () => {
    if (document.visibilityState === 'hidden') stop();
    else if (!duplicate && !problem) void start();
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

{#if mode === 'qr'}
  <h2>Scan sync code</h2>
{:else}
  <h1>Scan barcode</h1>
{/if}

{#if problem}
  <p role="alert">{problem === 'denied' ? 'Camera permission was denied.' : 'No camera is available.'}</p>
  <div class="actions">
    {#if mode === 'qr'}
      <button class="primary" onclick={() => oncancelScan?.()}>Type the code instead</button>
    {:else}
      <button class="primary" onclick={enterIsbn}>Enter ISBN</button>
    {/if}
  </div>
{:else}
  <div class="scan-view" class:flash>
    <video bind:this={video} playsinline muted></video>
    <div class="scan-guide" aria-hidden="true"></div>
  </div>
  {#if mode === 'qr'}
    <p class="muted">Point the camera at the QR code on your other device.</p>
    <div class="actions"><button onclick={() => oncancelScan?.()}>Cancel</button></div>
  {:else}
    <p class="muted">Point the camera at the barcode on the back of the book.</p>
  {/if}
  {#if hint && mode !== 'qr'}
    <p role="status">Having trouble? <button class="link" onclick={enterIsbn}>Enter ISBN</button></p>
  {/if}
{/if}

{#if duplicate}
  {@const dup = duplicate}
  <DuplicatePrompt
    existing={dup.existing}
    onaddcopy={() => { const isbn = dup.isbn; duplicate = null; void startIsbnFlow(isbn, { skipDuplicateCheck: true }); }}
    oncancel={() => { duplicate = null; void start(); }}
  />
{/if}
