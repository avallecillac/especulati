<script lang="ts">
  import type { Kind, Status } from '@especulati/cinefilo-core';
  import { todayLocal } from '../lib/clock.ts';
  import { KIND_LABEL, STATUS_LABEL, statusesFor } from '../lib/labels.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast, write } from '../lib/state.svelte.ts';
  import { failureText, thumbUrl, type TmdbResult } from '../catalog/tmdb.ts';
  import { details, search, tmdb } from '../lib/tmdb.svelte.ts';
  import { covers } from '../lib/covers.svelte.ts';
  import Cover from './Cover.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let title = $state('');
  let kind = $state<Kind>('movie');
  let year = $state('');
  let status = $state<Status>('later');
  let watchedOn = $state<string>(todayLocal());
  let error = $state<string | null>(null);
  let busy = $state(false);

  let query = $state('');
  let results = $state<TmdbResult[] | null>(null);
  let searching = $state(false);
  let searchNote = $state<string | null>(null);
  let addingId = $state<number | null>(null);

  const statuses = $derived(statusesFor(kind));
  const needsDate = $derived(status === 'watched' || status === 'dropped');

  function setKind(k: Kind) {
    kind = k;
    results = null;
    if (!statusesFor(k).includes(status)) status = 'later';
  }

  async function runSearch() {
    const q = query.trim();
    if (q === '' || searching) return;
    searching = true;
    searchNote = null;
    results = null;
    const r = await search(q, kind);
    searching = false;
    if (r.kind === 'ok') {
      results = r.value;
      if (r.value.length === 0) searchNote = 'No matches. Try another spelling, or add it by hand below.';
    } else if (r.kind !== 'no-key') {
      // Non-blocking: keep what was typed for manual entry.
      if (title.trim() === '') title = q;
      searchNote = `${failureText(r)} You can add it by hand below.`;
    }
  }

  /** One tap: fetch TMDB's details for the hit (falling back to the search data) and add it. */
  async function addResult(hit: TmdbResult) {
    if (addingId !== null) return;
    addingId = hit.tmdbId;
    error = null;
    const d = await details(hit.mediaKind, hit.tmdbId);
    const info = d.kind === 'ok' ? d.value : null;
    const name = info?.title ?? hit.title;
    const year = info?.year ?? hit.year;
    const poster = info?.posterPath ?? hit.posterPath;
    const r = await write({
      kind: 'AddTitle',
      mediaKind: hit.mediaKind,
      title: name,
      tmdbId: hit.tmdbId,
      status,
      ...(needsDate ? { watchedOn } : {}),
      ...(info?.originalTitle ?? hit.originalTitle ? { originalTitle: info?.originalTitle ?? hit.originalTitle } : {}),
      ...(year ? { year } : {}),
      ...(poster ? { posterUrl: poster } : {}),
      ...(info && info.genres.length > 0 ? { genres: info.genres } : {}),
      ...(info?.runtimeMin ? { runtimeMin: info.runtimeMin } : {}),
      ...(info?.seasonCount ? { seasonCount: info.seasonCount } : {}),
    });
    addingId = null;
    if (r.ok) {
      onclose();
      showToast(`Added ${name}.`);
      return;
    }
    const e = r.error;
    if (e.kind === 'AlreadyExists') {
      const id = e.id;
      onclose();
      showToast('Already on your list.');
      navigate(`/title/${encodeURIComponent(id)}`);
    } else error = 'Could not save. Try again.';
  }

  async function save() {
    error = null;
    const trimmed = year.trim();
    const y = trimmed === '' ? null : Number(trimmed);
    if (y !== null && !Number.isInteger(y)) return void (error = 'The year must be a number.');
    busy = true;
    const r = await write({
      kind: 'AddTitle',
      mediaKind: kind,
      title,
      ...(y !== null ? { year: y } : {}),
      status,
      ...(needsDate ? { watchedOn } : {}),
    });
    busy = false;
    if (r.ok) return void onclose();
    const e = r.error;
    if (e.kind === 'AlreadyExists') {
      // The same title is already in the catalog: open it instead of adding a second one.
      const id = e.id;
      onclose();
      showToast('Already on your list.');
      navigate(`/title/${encodeURIComponent(id)}`);
    } else if (e.kind === 'TitleRequired') error = 'A title is required.';
    else if (e.kind === 'InvalidInput') error = `${e.field}: ${e.reason}`;
    else error = 'Could not save. Try again.';
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Add a title">
  <div class="grabber" aria-hidden="true"></div>
  <h2>Add a title</h2>

  <fieldset>
    <legend>Kind</legend>
    <div class="seg">
      {#each ['movie', 'series'] as const as k (k)}
        <button type="button" aria-pressed={kind === k} onclick={() => setKind(k)}>{KIND_LABEL[k]}</button>
      {/each}
    </div>
  </fieldset>

  <section>
    {#if tmdb.key === null}
      <p class="muted" data-testid="search-unavailable">Search needs a TMDB key. Add one in Settings, or add the title by hand below.</p>
    {:else if !tmdb.online}
      <p class="muted" data-testid="search-unavailable">You are offline, so search is unavailable. Add the title by hand below.</p>
    {:else}
      <label for="tmdb-q">Search TMDB</label>
      <div class="actions">
        <input id="tmdb-q" autocomplete="off" bind:value={query} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(); } }} />
        <button type="button" onclick={() => void runSearch()} disabled={searching || query.trim() === ''}>Search</button>
      </div>
      {#if searchNote}<p role="status" class="muted" data-testid="search-note">{searchNote}</p>{/if}
      {#if results && results.length > 0}
        <label for="add-as">Add as</label>
        <select id="add-as" bind:value={status}>
          {#each statuses as s (s)}
            <option value={s}>{STATUS_LABEL[s]}</option>
          {/each}
        </select>
        <ul class="results" aria-label="Search results">
          {#each results as hit (`${hit.mediaKind}-${hit.tmdbId}`)}
            <li class="result">
              {#if hit.posterPath && tmdb.online && covers.mode !== 'generated'}
                <img class="thumb" src={thumbUrl(hit.posterPath)} alt="" width="46" height="69" loading="lazy" referrerpolicy="no-referrer" />
              {:else}
                <span class="thumb-cover"><Cover titleId={`tmdb-${hit.mediaKind}-${hit.tmdbId}`} /></span>
              {/if}
              <span class="meta">
                <span class="name clamp2">{hit.title}</span>
                <span class="muted small">{KIND_LABEL[hit.mediaKind]}{hit.year ? ` · ${hit.year}` : ''}</span>
                {#if hit.originalTitle}
                  <span class="muted small clamp1">{hit.originalTitle}</span>
                {:else if hit.overview}
                  <span class="muted small clamp1">{hit.overview}</span>
                {/if}
              </span>
              <button type="button" class="primary add" aria-label={`Add ${hit.title}${hit.year ? ` (${hit.year})` : ''}`} disabled={addingId !== null} onclick={() => void addResult(hit)}><span aria-hidden="true">+ Add</span></button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <h3>Or add by hand</h3>

  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label for="add-title">Title</label>
    <input id="add-title" autocomplete="off" bind:value={title} />

    <label for="add-year">Year</label>
    <input id="add-year" inputmode="numeric" autocomplete="off" placeholder="Optional" bind:value={year} />

    <label for="add-status">Status</label>
    <select id="add-status" bind:value={status}>
      {#each statuses as s (s)}
        <option value={s}>{STATUS_LABEL[s]}</option>
      {/each}
    </select>

    {#if needsDate}
      <label for="add-date">Date</label>
      <input id="add-date" type="date" bind:value={watchedOn} />
    {/if}

    <p role="alert" class="error">{error ?? ''}</p>
    <div class="actions">
      <button class="primary" type="submit" disabled={busy}>Add title</button>
      <button type="button" onclick={onclose}>Cancel</button>
    </div>
  </form>
</div>
