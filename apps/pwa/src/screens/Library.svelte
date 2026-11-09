<script lang="ts">
  import type { LibraryView } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { progressLabel } from '../lib/format.ts';
  import { reportError } from '../lib/errors.ts';
  import Cover from './Cover.svelte';
  import DetailsBadge from './DetailsBadge.svelte';
  import Fish from '../ornaments/Fish.svelte';
  import Articles from './Articles.svelte';
  import Saved from './Saved.svelte';
  import ArticleSearch from './ArticleSearch.svelte';

  let { initialTab = 'books' }: { initialTab?: 'books' | 'articles' | 'saved' } = $props();
  let view = $state<LibraryView | null>(null);
  // svelte-ignore state_referenced_locally
  let tab = $state<'books' | 'articles' | 'saved'>(initialTab);

  async function load() {
    const r = await query({ name: 'library' });
    if (r.ok) view = r.value;
    else reportError(r.error);
  }

  let searching = $state(false);
  let savedCount = $state(0);
  async function loadSaved() {
    const r = await query({ name: 'savedCount' });
    if (r.ok) savedCount = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    void loadSaved();
    return onChanged(() => {
      void load();
      void loadSaved();
    });
  });

  const groups = [
    ['reading', 'Reading'],
    ['queued', 'Queued'],
    ['finished', 'Finished'],
    ['abandoned', 'Abandoned'],
  ] as const;
</script>

<h1>Library</h1>

<div class="segmented" role="tablist" aria-label="Library">
  <button role="tab" id="tab-books" aria-selected={tab === 'books'} aria-controls="panel-library" onclick={() => (tab = 'books')}>Books</button>
  <button role="tab" id="tab-articles" aria-selected={tab === 'articles'} aria-controls="panel-library" onclick={() => (tab = 'articles')}>Articles</button>
  <button role="tab" id="tab-saved" aria-selected={tab === 'saved'} aria-controls="panel-library" aria-label="Saved" onclick={() => (tab = 'saved')}>Saved{savedCount > 0 ? ` (${savedCount})` : ''}</button>
</div>

{#if tab !== 'books'}
  <ArticleSearch bind:active={searching} />
{/if}

<div id="panel-library" role="tabpanel" aria-labelledby={`tab-${tab}`}>
{#if tab !== 'books' && searching}
  <!-- the search results (above) replace the lists -->
{:else if tab === 'articles'}
  <Articles onsaved={() => (tab = 'saved')} />
{:else if tab === 'saved'}
  <Saved />
{:else if view}
  {@const v = view}
  {#if groups.every(([key]) => v[key].length === 0)}
    <div class="vignette">
      <Fish size={30} />
      <p class="title">Your shelves are empty</p>
      <p class="muted">No books yet. <a href="#/add">Add one</a>.</p>
    </div>
  {/if}
  {#each groups as [key, label] (key)}
    {#if v[key].length > 0}
      <section aria-label={label}>
        <h2>{label} ({v[key].length})</h2>
        <ul class="plain">
          {#each v[key] as card (card.itemId)}
            <li>
              <Cover itemId={card.itemId} hasCover={card.hasCover} title={card.title} size="sm" />
              <div class="book-main">
                <a class="book-title" href={`#/book/${card.itemId}`}>{card.title}</a>
                {#if card.author}<span class="muted smallcaps">{card.author}</span>{/if}
              </div>
              <DetailsBadge status={card.detailsStatus} />
              <span class="spacer"></span>
              <span class="muted status">{progressLabel(card)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/each}
{/if}
</div>

<style>
  .book-main { display: grid; min-width: 0; }
  .book-title { font-weight: 500; overflow-wrap: anywhere; color: var(--ink); }
  .status { font-style: italic; font-size: 0.9rem; text-align: right; }
  .vignette .title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 600; }
</style>
