<script lang="ts">
  import { readingMinutes } from '@readerlog/core';
  import type { SavedArticle } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { longDate } from '../lib/dates.ts';
  import { reportError } from '../lib/errors.ts';
  import { markArticleRead, removeArticle } from '../lib/actions.ts';
  import Butterfly from '../ornaments/Butterfly.svelte';

  let saved = $state<SavedArticle[] | null>(null);
  /** The row whose More sheet is open. */
  let menu = $state<SavedArticle | null>(null);

  async function load() {
    const r = await query({ name: 'savedArticles' });
    if (r.ok) saved = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  /** The saved date is `createdAt`, shown as a local calendar date. */
  const savedOn = (a: SavedArticle): string => longDate(todayLocal(new Date(a.createdAt)));

  function meta(a: SavedArticle): string {
    const m = readingMinutes(a.wordCount);
    return m === null ? a.domain : `${a.domain} · ~${m} min`;
  }

  async function markRead(id: string) {
    menu = null;
    await markArticleRead(id);
  }

  async function remove(id: string) {
    menu = null;
    await removeArticle(id, 'Removed from Saved');
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (menu = null)} />

{#if saved}
  {#if saved.length === 0}
    <div class="vignette">
      <Butterfly size={40} />
      <p class="muted">Nothing saved yet. Save articles to read them later.</p>
    </div>
  {:else}
    <ul class="plain" aria-label="Saved">
      {#each saved as a (a.id)}
        <li data-testid="saved-row">
          <div class="article-main">
            <a class="article-title" href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
            <span class="muted">{meta(a)}</span>
            <span class="muted smallcaps">Saved {savedOn(a)}</span>
          </div>
          <span class="spacer"></span>
          <button type="button" class="more" aria-label="More" aria-haspopup="dialog" onclick={() => (menu = a)}>…</button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

{#if menu}
  {@const m = menu}
  <div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (menu = null)}>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="saved-more-title">
      <h1 id="saved-more-title">{m.title}</h1>
      <div class="actions">
        <button class="primary" type="button" onclick={() => void markRead(m.id)}>Mark as read</button>
        <a class="button" href={`#/article/${m.id}`}>Details</a>
        <button class="danger" type="button" onclick={() => void remove(m.id)}>Remove</button>
        <button type="button" onclick={() => (menu = null)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .more { flex: none; min-width: var(--tap); font-size: 1.3rem; line-height: 1; }
  #saved-more-title { overflow-wrap: anywhere; }
</style>
