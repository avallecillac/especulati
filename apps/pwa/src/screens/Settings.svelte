<script lang="ts">
  import type { StorageInfo } from '../lib/protocol.ts';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { maskKey, removeGoogleKey, saveGoogleKey, settings } from '../lib/settings.svelte.ts';
  import { syncState } from '../lib/sync.svelte.ts';
  import { summaryLine } from '../lib/syncText.ts';
  import { testGoogleKey, type KeyTestResult } from '../catalog/googleKey.ts';

  let keyText = $state('');
  let keyResult = $state<string | null>(null);
  let testing = $state(false);

  const resultText = (r: KeyTestResult): string =>
    r.kind === 'ok' ? 'Key works'
    : r.kind === 'rejected' ? 'Key rejected by Google'
    : r.kind === 'refererBlocked' ? 'Key blocked for this website (check the referrer restriction)'
    : r.kind === 'quota' ? 'Daily quota used up'
    : r.kind === 'offline' ? 'No connection'
    : `Google answered ${r.status}`;

  async function saveKey() {
    const k = keyText.trim();
    if (k === '') return;
    await saveGoogleKey(k);
    keyText = '';
    keyResult = null;
  }

  async function removeKey() {
    await removeGoogleKey();
    keyText = '';
    keyResult = null;
  }

  async function testKey() {
    const k = keyText.trim() || settings.googleBooksKey;
    if (k === '') return;
    testing = true;
    keyResult = null;
    const r = await testGoogleKey(k, { fetch: (u, i) => fetch(u, i) });
    testing = false;
    keyResult = resultText(r);
  }

  let info = $state<StorageInfo | null>(null);
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(t);
  });

  async function load() {
    const r = await query({ name: 'storage' });
    if (r.ok) info = r.value;
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });
</script>

<h1>Settings</h1>

{#if info}
  <section class="card">
    {#if info.persisted}
      <p><strong>Storage: persistent.</strong> Your browser won't clear Readerlog's data to free space.</p>
    {:else}
      <p><strong>Storage: not persistent.</strong></p>
      <p class="muted">
        The browser may clear data under storage pressure. On iPhone, add Readerlog to your Home Screen
        (Share → Add to Home Screen) and open it from there. Export and sync are coming in later versions.
      </p>
    {/if}
  </section>

  <section class="card">
    <p class="muted">Device</p>
    <p><code data-testid="device-id">{info.deviceId}</code></p>
    <p class="muted" data-testid="app-version">Readerlog {__APP_VERSION__}</p>
    <p class="muted">Schema version {info.schemaVersion}</p>
    <p class="muted" data-testid="cover-stats">Covers stored: {info.covers.count} ({Math.round(info.covers.bytes / 1024)} KB)</p>
  </section>
{/if}

<section class="card">
  <h2>Sync</h2>
  <p class="muted">Keep your reading log on more than one device, end-to-end encrypted.</p>
  {#if syncState.status}<p data-testid="settings-sync-status">{summaryLine(syncState.status, now)}</p>{/if}
  <a class="button" href="#/settings/sync">Sync</a>
  <p class="muted"><a href="https://github.com/avallecillac/reader-log/blob/main/docs/ios-shortcut.md" target="_blank" rel="noopener noreferrer">Log articles from your iPhone</a></p>
</section>

<section class="card">
  <h2>Google Books API key (optional)</h2>
  <p class="muted">Restrict the key to the Books API and to this website's address.</p>
  {#if settings.googleBooksKey}
    <p>Saved key: <code data-testid="google-key-mask">{maskKey(settings.googleBooksKey)}</code></p>
  {/if}
  <label for="google-key">Google Books API key</label>
  <input id="google-key" type="password" autocomplete="off" bind:value={keyText} />
  <div class="row">
    <button type="button" onclick={saveKey} disabled={keyText.trim() === ''}>Save</button>
    <button type="button" onclick={testKey} disabled={testing || (keyText.trim() === '' && !settings.googleBooksKey)}>Test key</button>
    <button type="button" onclick={removeKey} disabled={!settings.googleBooksKey}>Remove</button>
  </div>
  <p role="status">{keyResult ?? ''}</p>
</section>
