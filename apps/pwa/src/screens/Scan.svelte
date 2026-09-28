<script lang="ts">
  import { onMount } from 'svelte';
  import type { BookCard } from '@readerlog/db';
  import { createScannerWorker, scanFrames, startCamera, stopCamera } from '../scanner/camera.ts';
  import { startIsbnFlow } from '../lib/isbnFlow.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import Confirm from './Confirm.svelte';

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
    stopScan = scanFrames(video, worker, (isbn) => void onIsbn(isbn));
    hintTimer = setTimeout(() => (hint = true), HINT_AFTER_MS);
  }

  async function onIsbn(isbn: string): Promise<void> {
    navigator.vibrate?.(40);
    flash = true;
    setTimeout(() => (flash = false), 250);
    stop();
    const r = await startIsbnFlow(isbn);
    if (r.kind === 'duplicate' && !destroyed) duplicate = { isbn, existing: r.existing };
  }

  const enterIsbn = () => navigate('/add'); // US4 points this at the ISBN field.

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

<h1>Scan barcode</h1>

{#if problem}
  <p role="alert">{problem === 'denied' ? 'Camera permission was denied.' : 'No camera is available.'}</p>
  <div class="actions"><button class="primary" onclick={enterIsbn}>Enter ISBN</button></div>
{:else}
  <div class="scan-view" class:flash>
    <video bind:this={video} playsinline muted></video>
    <div class="scan-guide" aria-hidden="true"></div>
  </div>
  <p class="muted">Point the camera at the barcode on the back of the book.</p>
  {#if hint}
    <p role="status">Having trouble? <button class="link" onclick={enterIsbn}>Enter ISBN</button></p>
  {/if}
{/if}

{#if duplicate}
  {@const dup = duplicate}
  <Confirm
    title="Already in your library"
    body={`“${dup.existing.title}” is already in your library.`}
    confirmLabel="Open existing"
    secondaryLabel="Add another copy"
    onconfirm={() => navigate(`/book/${dup.existing.itemId}`)}
    onsecondary={() => { duplicate = null; void startIsbnFlow(dup.isbn, { skipDuplicateCheck: true }); }}
    oncancel={() => { duplicate = null; void start(); }}
  />
{/if}
