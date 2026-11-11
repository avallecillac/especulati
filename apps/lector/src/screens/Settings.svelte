<script lang="ts">
  import type { StorageInfo } from '../lib/protocol.ts';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { maskKey, removeGoogleKey, saveGoogleKey, settings } from '../lib/settings.svelte.ts';
  import { syncState } from '../lib/sync.svelte.ts';
  import { summaryLine } from '../lib/syncText.ts';
  import { appearance, setAppearance } from '../lib/appearance.svelte.ts';
  import { THEMES, themeById, type Appearance } from '../theme/themes.ts';
  import Rule from '../ornaments/Rule.svelte';
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

  // Swatch colours come from the theme registry and reach CSS through custom properties.
  const autoSwatch = [themeById('macondo').swatch[0], themeById('patriarca').swatch[0], themeById('macondo').swatch[1]] as const;
  const choices: { id: Appearance; name: string; swatch: readonly [string, string, string] }[] = [
    { id: 'automatic', name: 'Automatic', swatch: autoSwatch },
    ...THEMES.map((t) => ({ id: t.id, name: t.name, swatch: t.swatch })),
  ];

  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = choices[(i + step + choices.length) % choices.length]!;
    setAppearance(next.id);
    (e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector<HTMLElement>(`[data-choice="${next.id}"]`)?.focus();
  }
</script>

<h1>Settings</h1>

<section aria-labelledby="appearance-title">
  <h2 id="appearance-title">Appearance</h2>
  <ul class="plain appearance" role="radiogroup" aria-label="Appearance">
    {#each choices as c, i (c.id)}
      {@const on = appearance.value === c.id}
      <li role="none">
        <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-choice={c.id}
          onclick={() => setAppearance(c.id)} onkeydown={(e) => onKey(e, i)}>
          <span class="swatch" aria-hidden="true" style:--s1={c.swatch[0]} style:--s2={c.swatch[1]} style:--s3={c.swatch[2]}><i></i><i></i><i></i></span>
          <span class="name">{c.name}</span>
          <span class="spacer"></span>
          {#if on}
            <svg class="tick" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</section>

<Rule />

<section class="card">
  <h2>Sync</h2>
  <p class="muted">Keep your reading log on more than one device, end-to-end encrypted.</p>
  {#if syncState.status}<p data-testid="settings-sync-status">{summaryLine(syncState.status, now)}</p>{/if}
  <a class="button" href="#/settings/sync">Sync settings</a>
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

<Rule />

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

<style>
  .appearance li { padding: 0; }
  .appearance button {
    width: 100%; min-height: 44px; padding: 11px 16px; border: 0; border-radius: 0; background: none;
    justify-content: flex-start; gap: 12px; text-align: left; font-weight: 400;
  }
  .swatch { display: inline-flex; flex: none; }
  .swatch i { width: 14px; height: 14px; border-radius: 50%; border: 0.5px solid var(--ink-soft); background: var(--s1); }
  .swatch i + i { margin-left: -5px; background: var(--s2); }
  .swatch i + i + i { background: var(--s3); }
  .tick { color: var(--accent); flex: none; }
</style>
