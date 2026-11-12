<script lang="ts">
  import { eraseAll, exportCatalog, importCatalog, importTitlesList, type TitlesImportPreview, syncReset, syncShowCode, syncTurnOn, type CodeView } from '../lib/dbClient.ts';
  import { TITLES_FORMAT } from '@especulati/cinefilo-core';
  import { qrSvg } from '../lib/qr.ts';
  import { app, refresh, runSync, showToast, write } from '../lib/state.svelte.ts';
  import { setMe } from '../lib/dbClient.ts';
  import { GENERIC_FAILURE, syncErrorText } from '../lib/syncText.ts';
  import { localDate } from '../lib/clock.ts';
  import { saveTmdbKey, tmdb } from '../lib/tmdb.svelte.ts';
  import TmdbLogo from './TmdbLogo.svelte';
  import { appearance, setAppearance } from '../lib/appearance.svelte.ts';
  import { covers, setCovers, type CoversMode } from '../lib/covers.svelte.ts';
  import { THEMES, type Appearance } from '../theme/themes.ts';

  let shown = $state<{ code: string; svg: string } | null>(null);
  let error = $state<string | null>(null);
  let confirming = $state<'leave' | 'reset' | null>(null);
  let names = $state<Record<string, string>>({});
  let busy = $state(false);
  let keyDraft = $state('');
  let listPreview = $state<{ text: string; counts: TitlesImportPreview } | null>(null);

  const status = $derived(app.sync);

  const appearanceChoices: { id: Appearance; name: string }[] = [{ id: 'automatic', name: 'Automatic' }, ...THEMES.map((t) => ({ id: t.id, name: t.name }))];
  const coverChoices: { id: CoversMode; name: string }[] = [{ id: 'posters', name: 'TMDB posters' }, { id: 'generated', name: 'Generated' }];

  // Radio groups: arrow keys move the choice and the focus together.
  function onRadioKey(e: KeyboardEvent, ids: string[], i: number, pick: (id: string) => void) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = ids[(i + step + ids.length) % ids.length]!;
    pick(next);
    (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
  }

  async function reveal(c: CodeView) {
    shown = { code: c.code, svg: await qrSvg(c.qr) };
  }

  async function showCode() {
    const r = await syncShowCode();
    if (r.ok && r.value) await reveal(r.value);
  }

  async function turnOn() {
    busy = true;
    error = null;
    const r = await syncTurnOn();
    busy = false;
    if (!r.ok) return void (error = GENERIC_FAILURE);
    if (!r.value.ok) return void (error = syncErrorText(r.value.error.kind as Parameters<typeof syncErrorText>[0]));
    await refresh();
    await reveal(r.value.value);
  }

  async function startNewSpace() {
    confirming = null;
    busy = true;
    error = null;
    const r = await syncReset();
    busy = false;
    if (!r.ok) return void (error = GENERIC_FAILURE);
    if (!r.value.ok) return void (error = syncErrorText(r.value.error.kind as Parameters<typeof syncErrorText>[0]));
    await refresh();
    await reveal(r.value.value);
    showToast('New shared list started. Share the new code.');
  }

  async function rename(id: string) {
    const name = names[id] ?? '';
    const r = await write({ kind: 'RenameMember', memberId: id, name });
    if (!r.ok) return void (error = 'Please enter a name.');
    error = null;
    delete names[id];
    await refresh();
  }

  async function iAm(id: string) {
    await setMe(id);
    await refresh();
  }

  async function download(): Promise<boolean> {
    const r = await exportCatalog();
    if (!r.ok) {
      error = GENERIC_FAILURE;
      return false;
    }
    const url = URL.createObjectURL(new Blob([r.value], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cinefilo-${localDate()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }

  async function saveKey(value: string) {
    const ok = await saveTmdbKey(value);
    if (!ok) return void (error = GENERIC_FAILURE);
    error = null;
    keyDraft = '';
    showToast(value.trim() === '' ? 'TMDB key removed from this device.' : 'TMDB key saved on this device.');
  }

  async function leave() {
    confirming = null;
    await eraseAll();
    location.hash = '#/';
    location.reload();
  }

  async function onImport(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const text = await file.text();
    // A titles list picked through the backup button: open the list preview instead of failing.
    if (isTitlesList(text)) return void (await previewList(text));
    const r = await importCatalog(text);
    if (!r.ok) return void (error = GENERIC_FAILURE);
    if (!r.value.ok) return void (error = `That file can't be imported (${r.value.error.field}: ${r.value.error.reason}).`);
    error = null;
    await refresh();
    showToast(`Imported ${r.value.value.added} ${r.value.value.added === 1 ? 'item' : 'items'}.`);
  }

  /** Import list, step 1: read the file and show the preview. Nothing is written yet. */
  async function onPickList(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    await previewList(await file.text());
  }

  function isTitlesList(text: string): boolean {
    try {
      const raw: unknown = JSON.parse(text);
      return typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === TITLES_FORMAT;
    } catch {
      return false;
    }
  }

  async function previewList(text: string) {
    const r = await importTitlesList(text, true);
    if (!r.ok) return void (error = GENERIC_FAILURE);
    if (!r.value.ok) return void (error = `That file can't be imported (${r.value.error.field}: ${r.value.error.reason}).`);
    error = null;
    listPreview = { text, counts: r.value.value };
  }

  /** Step 2: the member confirmed. One transaction in the worker, or nothing. */
  async function confirmList() {
    const p = listPreview;
    if (!p || busy) return;
    const text = p.text;
    busy = true;
    const r = await importTitlesList(text, false);
    busy = false;
    listPreview = null;
    if (!r.ok) return void (error = GENERIC_FAILURE);
    if (!r.value.ok) return void (error = `That file can't be imported (${r.value.error.field}: ${r.value.error.reason}).`);
    error = null;
    await refresh();
    const n = r.value.value.new;
    const o = r.value.value.ordersToSet;
    showToast(n === 0 && o > 0 ? `Set ${o} ${o === 1 ? 'order' : 'orders'}.` : `Imported ${n} ${n === 1 ? 'title' : 'titles'}.`);
  }
</script>

<header class="bar"><h1>Settings</h1></header>

<section class="card" aria-labelledby="appearance-h">
  <h2 id="appearance-h">Appearance</h2>
  <p class="muted small">Saved on this device only. Automatic follows the device: Béton in light mode, Willis in dark.</p>
  <div class="seg choice tall" role="radiogroup" aria-label="Appearance">
    {#each appearanceChoices as c, i (c.id)}
      {@const on = appearance.value === c.id}
      <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-choice={c.id} onclick={() => setAppearance(c.id)}
        onkeydown={(e) => onRadioKey(e, appearanceChoices.map((x) => x.id), i, setAppearance)}>{c.name}</button>
    {/each}
  </div>
  <h3 class="covers-h" id="covers-h">Covers</h3>
  <div class="seg choice tall" role="radiogroup" aria-labelledby="covers-h">
    {#each coverChoices as c, i (c.id)}
      {@const on = covers.mode === c.id}
      <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-choice={c.id} onclick={() => setCovers(c.id)}
        onkeydown={(e) => onRadioKey(e, coverChoices.map((x) => x.id), i, (id) => setCovers(id as CoversMode))}>{c.name}</button>
    {/each}
  </div>
</section>

<section class="card" aria-labelledby="who-h">
  <h2 id="who-h">Members</h2>
  <p class="muted small">Pick who this device is, or rename anyone.</p>
  {#each app.members as m (m.id)}
    <div class="member">
      <button type="button" aria-pressed={m.me} onclick={() => void iAm(m.id)}>{m.me ? `${m.name} (this device)` : `I'm ${m.name}`}</button>
      <input aria-label={`New name for ${m.name}`} placeholder="Rename" bind:value={names[m.id]} />
      <button type="button" onclick={() => void rename(m.id)} disabled={!names[m.id]?.trim()}>Rename {m.name}</button>
    </div>
  {/each}
</section>

<section class="card" aria-labelledby="share-h">
  <h2 id="share-h">Sharing</h2>
  <p class="muted">
    Anyone who has the sync code can read the whole list and act as either member. The only way to cut off access is to start a new shared list,
    which makes a new code.
  </p>
  {#if status?.on}
    <p data-testid="sync-status" class="muted small">
      {status.lastOkAt ? `Last synced ${new Date(status.lastOkAt).toLocaleTimeString()}` : 'Not synced yet'}{status.pending ? ` · ${status.pending} waiting to send` : ''}{status.problem ? ` · problem: ${status.problem}` : ''}
    </p>
    <div class="actions">
      <button class="primary" type="button" onclick={() => void runSync('manual')} disabled={app.syncing}>Sync now</button>
      <button type="button" onclick={() => void showCode()}>Show code</button>
      <button type="button" onclick={() => (confirming = 'reset')} disabled={busy}>Start a new shared list</button>
    </div>
    {#if shown}
      <div class="qr" role="img" aria-label="Sync code QR">{@html shown.svg}</div>
      <p><code data-testid="sync-code">{shown.code}</code></p>
      <button type="button" onclick={() => (shown = null)}>Hide code</button>
    {/if}
  {:else}
    <p>Sharing is off on this device.</p>
    <button class="primary" type="button" onclick={() => void turnOn()} disabled={busy}>Start sharing</button>
    {#if shown}<p><code data-testid="sync-code">{shown.code}</code></p>{/if}
  {/if}
</section>

<section class="card" aria-labelledby="data-h">
  <h2 id="data-h">Your data</h2>
  <div class="actions">
    <button type="button" onclick={() => void download()}>Export</button>
    <label class="button" for="import-file">Import</label>
    <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" onchange={onImport} />
  </div>
</section>

<section class="card" aria-labelledby="list-h">
  <h2 id="list-h">Import list</h2>
  <p class="muted">Add many titles at once from a Cinéfilo titles file (<code>cinefilo-titles/v1</code>). You see a preview first, and titles already in the list are left as they are.</p>
  <div class="actions">
    <label class="button" for="import-list-file">Import list</label>
    <input id="import-list-file" class="visually-hidden" type="file" accept="application/json,.json" onchange={onPickList} />
  </div>
</section>

<section class="card" aria-labelledby="tmdb-h">
  <h2 id="tmdb-h">Movie search (TMDB)</h2>
  <p class="muted">
    Paste your own free TMDB key (the v3 API key or the v4 read access token) to search for titles and get posters. The key stays on this
    device: it is never shared with your partner, synced or exported. Searches send only the text you type to TMDB.
  </p>
  <p data-testid="tmdb-key-status" class="muted small">{tmdb.key ? 'A key is saved on this device.' : 'No key yet. You can still add titles by hand.'}</p>
  <label for="tmdb-key">TMDB key</label>
  <input id="tmdb-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={keyDraft} />
  <div class="actions">
    <button type="button" class="primary" onclick={() => void saveKey(keyDraft)} disabled={keyDraft.trim() === ''}>Save key</button>
    {#if tmdb.key}<button type="button" onclick={() => void saveKey('')}>Remove key</button>{/if}
  </div>
</section>

<section class="card" aria-labelledby="about-h">
  <h2 id="about-h">About</h2>
  <TmdbLogo />
  <p data-testid="tmdb-attribution">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  <p class="muted small">Cinéfilo {__APP_VERSION__}</p>
</section>

<section class="card">
  <h2>Leave</h2>
  <p class="muted">Stops sharing and erases the list from this device. Other devices keep theirs.</p>
  <button type="button" class="danger" onclick={() => (confirming = 'leave')}>Leave the shared list</button>
</section>

<p role="alert" class="error">{error ?? ''}</p>

{#if listPreview}
  {@const c = listPreview.counts}
  <div class="backdrop" role="presentation" onclick={() => (listPreview = null)}></div>
  <div class="sheet" role="dialog" aria-label="Import list preview">
    <h2>Import list</h2>
    <ul class="preview" data-testid="import-preview">
      <li><strong data-testid="preview-new">{c.new}</strong> new</li>
      <li><strong data-testid="preview-existing">{c.existing}</strong> already in your list</li>
      {#if c.ordersToSet > 0}<li><strong data-testid="preview-orders">{c.ordersToSet}</strong> {c.ordersToSet === 1 ? 'order' : 'orders'} to set</li>{/if}
      <li><strong data-testid="preview-invalid">{c.invalid}</strong> invalid</li>
    </ul>
    {#if c.reasons.length > 0}
      <ul class="small muted">
        {#each c.reasons.slice(0, 5) as x (x.index)}<li>{x.title}: {x.reason}</li>{/each}
        {#if c.reasons.length > 5}<li>and {c.reasons.length - 5} more</li>{/if}
      </ul>
      <p class="muted">Nothing can be imported until these are fixed.</p>
    {:else if c.new === 0 && c.ordersToSet === 0}
      <p class="muted">Nothing new to import.</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" disabled={busy || (c.new === 0 && c.ordersToSet === 0) || c.invalid > 0} onclick={() => void confirmList()}>
        {c.new === 0 && c.ordersToSet > 0 ? `Set ${c.ordersToSet} ${c.ordersToSet === 1 ? 'order' : 'orders'}` : c.new === 1 ? 'Import 1 title' : `Import ${c.new} titles`}
      </button>
      <button type="button" onclick={() => (listPreview = null)}>Cancel</button>
    </div>
  </div>
{/if}

{#if confirming}
  <div class="backdrop" role="presentation" onclick={() => (confirming = null)}></div>
  <div class="sheet" role="alertdialog" aria-label={confirming === 'leave' ? 'Leave the shared list?' : 'Start a new shared list?'}>
    {#if confirming === 'leave'}
      <h2>Leave the shared list?</h2>
      <p>This erases the list and the sync code from this device. Export first if you want a copy.</p>
      <div class="actions">
        <button type="button" onclick={() => void download()}>Export first</button>
        <button type="button" class="danger" onclick={() => void leave()}>Leave and erase</button>
        <button type="button" onclick={() => (confirming = null)}>Cancel</button>
      </div>
    {:else}
      <h2>Start a new shared list?</h2>
      <p>The list moves to a new code. Devices with the old code stop receiving changes, so share the new code only with who you choose.</p>
      <div class="actions">
        <button type="button" class="primary" onclick={() => void startNewSpace()}>Start new list</button>
        <button type="button" onclick={() => (confirming = null)}>Cancel</button>
      </div>
    {/if}
  </div>
{/if}
