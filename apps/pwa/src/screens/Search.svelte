<script lang="ts">
  import { onMount } from 'svelte';
  import type { BookCard } from '@readerlog/db';
  import { searchTitle } from '../catalog/titleSearch.ts';
  import { authorsLabel } from '../catalog/merge.ts';
  import type { SearchHit } from '../catalog/types.ts';
  import { query as dbQuery } from '../lib/dbClient.ts';
  import { draft } from '../lib/draft.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { settings } from '../lib/settings.svelte.ts';
  import Cover from './Cover.svelte';
  import DuplicatePrompt from './DuplicatePrompt.svelte';

  let text = $state('');
  let short = $state(false);
  let view = $state<
    | { kind: 'idle' }
    | { kind: 'searching' }
    | { kind: 'results'; hits: SearchHit[] }
    | { kind: 'unavailable' }
    | { kind: 'timeout' }
  >({ kind: 'idle' });
  let asked = '';
  let duplicate = $state<{ hit: SearchHit; existing: BookCard } | null>(null);
  let destroyed = false;
  // Bumped per search so a slow earlier response never overwrites a newer one.
  let generation = 0;

  onMount(() => () => (destroyed = true));

  const label = (h: SearchHit) => [h.title, authorsLabel(h.authors), h.firstPublishYear].filter((x) => x !== null && x !== '').join(' · ');

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    const q = text.trim();
    short = q.length < 3;
    if (short) return;
    asked = q;
    const mine = ++generation;
    view = { kind: 'searching' };
    const out = await searchTitle(q, { fetch: (u, i) => fetch(u, i), online: () => navigator.onLine, googleApiKey: settings.googleBooksKey });
    if (mine !== generation || destroyed) return;
    view = out;
  }

  function useHit(hit: SearchHit, allowDuplicate = false) {
    draft.current = { source: 'search', isbn: hit.isbn, lookup: 'found', details: hit, ...(allowDuplicate ? { allowDuplicate } : {}) };
    navigate('/add');
  }

  async function pick(hit: SearchHit) {
    if (hit.isbn) {
      const r = await dbQuery({ name: 'findByIsbn', isbn: hit.isbn });
      if (destroyed) return;
      if (r.ok && r.value) {
        duplicate = { hit, existing: r.value };
        return;
      }
    }
    useHit(hit);
  }

  function addManually() {
    draft.current = {
      source: 'manual',
      isbn: null,
      lookup: 'idle',
      details: { title: asked, authors: [], totalPages: null, genre: null, coverUrl: null, firstPublishYear: null, source: 'openlibrary' },
    };
    navigate('/add');
  }
</script>

<h1>Search by title</h1>

<form onsubmit={submit} novalidate>
  <label for="search-title">Title</label>
  <input id="search-title" type="text" autocomplete="off" bind:value={text} oninput={() => (short = false)} aria-invalid={short} />
  {#if short}<p class="error">Type at least 3 characters.</p>{/if}
  <div class="actions">
    <button class="primary" type="submit">Search</button>
  </div>
</form>

{#if view.kind === 'searching'}
  <p role="status">Searching…</p>
{:else if view.kind === 'results' && view.hits.length > 0}
  <ul class="plain">
    {#each view.hits as hit (hit.key)}
      <li>
        <button type="button" class="hit" aria-label={label(hit)} onclick={() => void pick(hit)}>
          <Cover url={hit.coverUrl} title={hit.title ?? ''} size="sm" />
          <span>
            <strong>{hit.title}</strong><br />
            <span class="muted">{[authorsLabel(hit.authors), hit.firstPublishYear].filter((x) => x !== null).join(' · ')}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{:else if view.kind === 'results'}
  <p role="status">No matches</p>
  <div class="actions"><button onclick={addManually}>Add manually</button></div>
{:else if view.kind === 'unavailable' || view.kind === 'timeout'}
  <p role="status">
    {view.kind === 'timeout'
      ? "Couldn't search — the catalogs are taking too long."
      : "Couldn't search — you're offline or the catalogs are unavailable."}
  </p>
  <div class="actions"><button onclick={addManually}>Add manually</button></div>
{/if}

{#if duplicate}
  {@const dup = duplicate}
  <DuplicatePrompt
    existing={dup.existing}
    onaddcopy={() => { const hit = dup.hit; duplicate = null; useHit(hit, true); }}
    oncancel={() => (duplicate = null)}
  />
{/if}
