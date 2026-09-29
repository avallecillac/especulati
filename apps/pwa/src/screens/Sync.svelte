<script lang="ts">
  import { formatSyncCode, parseQrPayload, type SyncError } from '@readerlog/sync';
  import { sync } from '../lib/dbClient.ts';
  import { qrSvg } from '../lib/qr.ts';
  import type { SyncCode } from '../lib/protocol.ts';
  import Scan from './Scan.svelte';

  type Mode = 'loading' | 'off' | 'joining' | 'on';

  let mode = $state<Mode>('loading');
  let scanning = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let text = $state('');
  let shown = $state<{ code: string; svg: string } | null>(null);

  const errorText = (kind: SyncError['kind']): string =>
    kind === 'format' || kind === 'checksum' ? 'That code has a typo'
    : kind === 'notFound' ? 'No sync space found for this code'
    : kind === 'offline' ? "You're offline. Connect to the internet and try again."
    : "The sync server isn't answering. Try again in a moment.";

  const FAILED = 'Something went wrong on this device. Try again.';

  async function load() {
    const r = await sync({ action: 'status' });
    mode = r.ok && r.value.on ? 'on' : 'off';
  }
  void load();

  async function reveal(c: SyncCode) {
    shown = { code: c.code, svg: await qrSvg(c.qr) };
  }

  async function turnOn() {
    busy = true;
    error = null;
    const r = await sync({ action: 'turnOn' });
    busy = false;
    if (!r.ok) return void (error = FAILED);
    if (!r.value.ok) return void (error = errorText(r.value.error.kind));
    mode = 'on';
    await reveal(r.value.value);
  }

  async function join(code: string) {
    busy = true;
    error = null;
    const r = await sync({ action: 'join', code });
    busy = false;
    if (!r.ok) return void (error = FAILED);
    if (!r.value.ok) return void (error = errorText(r.value.error.kind));
    text = '';
    mode = 'on';
  }

  async function showCode() {
    const r = await sync({ action: 'showCode' });
    if (r.ok && r.value) await reveal(r.value);
  }

  function onScanned(payload: string) {
    scanning = false;
    const k = parseQrPayload(payload);
    if (!k.ok) return void (error = errorText(k.error));
    void join(formatSyncCode(k.value));
  }
</script>

<h1>Sync</h1>

{#if scanning}
  <Scan mode="qr" onscanned={onScanned} oncancel={() => (scanning = false)} />
{:else if mode === 'off'}
  <section class="card">
    <p>Keep your reading log on your other devices. Everything is encrypted on this device before it is sent.</p>
    <div class="actions">
      <button class="primary" type="button" onclick={turnOn} disabled={busy}>Turn on sync</button>
      <button type="button" onclick={() => { error = null; mode = 'joining'; }} disabled={busy}>Join</button>
    </div>
  </section>
{:else if mode === 'joining'}
  <section class="card">
    <label for="sync-code-input">Sync code</label>
    <textarea id="sync-code-input" rows="3" autocomplete="off" autocapitalize="characters" spellcheck="false" bind:value={text}></textarea>
    <div class="actions">
      <button class="primary" type="button" onclick={() => void join(text)} disabled={busy || text.trim() === ''}>Join</button>
      <button type="button" onclick={() => { error = null; scanning = true; }} disabled={busy}>Scan code</button>
      <button type="button" onclick={() => { error = null; mode = 'off'; }} disabled={busy}>Cancel</button>
    </div>
  </section>
{:else if mode === 'on'}
  <section class="card">
    <p><strong>Sync is on.</strong></p>
    <p class="muted" data-testid="sync-status">Status appears here.</p>
    {#if shown}
      <div class="qr" role="img" aria-label="Sync code QR">{@html shown.svg}</div>
      <p><code data-testid="sync-code">{shown.code}</code></p>
      <p class="muted">
        Save this code somewhere safe (for example a password manager) — it's the only way to recover your sync space.
      </p>
      <div class="actions"><button type="button" onclick={() => (shown = null)}>Hide code</button></div>
    {:else}
      <div class="actions"><button type="button" onclick={showCode}>Show code</button></div>
    {/if}
  </section>
{/if}

<p role="alert">{error ?? ''}</p>
