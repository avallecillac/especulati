<script lang="ts">
  import { untrack } from 'svelte';
  import { readingMinutes, type Article } from '@readerlog/core';
  import type { SavedArticle } from '@readerlog/db';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { markArticleRead, removeArticle } from '../lib/actions.ts';
  import { longDate } from '../lib/dates.ts';
  import { errorMessage, reportError } from '../lib/errors.ts';
  import { navigate } from '../lib/router.svelte.ts';
    import Confirm from './Confirm.svelte';
  import HighlightList from './HighlightList.svelte';

  let props: { id: string } = $props();
  // The route is keyed on the id ({#key} in App.svelte).
  const id = untrack(() => props.id);

  let article = $state<Article | null | undefined>(undefined);
  /** Set instead of `article` while this item is saved (no read date yet, 008). */
  let saved = $state<SavedArticle | null>(null);
  let editing = $state(false);
  let removing = $state(false);
  let title = $state('');
  let author = $state('');
  let readOn = $state('');
  let error = $state<string | null>(null);

  async function load() {
    const r = await query({ name: 'article', itemId: id });
    if (!r.ok) return reportError(r.error);
    if (r.value) {
      article = r.value;
      saved = null;
      return;
    }
    const s = await query({ name: 'savedArticle', itemId: id });
    if (!s.ok) return reportError(s.error);
    saved = s.value;
    article = null;
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  function startEditing(a: Article) {
    title = a.title;
    author = a.author ?? '';
    readOn = a.readOn;
    error = null;
    editing = true;
  }

  async function save(e: SubmitEvent, a: Article) {
    e.preventDefault();
    error = null;
    const r = await dispatch({
      kind: 'EditArticle',
      itemId: a.id,
      title,
      author: author.trim() === '' ? null : author,
      readOn,
    });
    if (!r.ok) return void (error = errorMessage(r.error));
    editing = false;
    await load();
  }

  async function remove() {
    removing = false;
    if (await removeArticle(id, 'Article removed')) navigate('/articles');
  }

  /** The saved date is `createdAt`, shown as a local calendar date. */
  const savedOn = (a: SavedArticle): string => longDate(todayLocal(new Date(a.createdAt)));

  function minutesLabel(a: Article | SavedArticle): string {
    const m = readingMinutes(a.wordCount);
    return m === null ? '—' : `~${m} min`;
  }
</script>

{#if article === null && saved === null}
  <p class="muted">This article no longer exists. <a href="#/articles">Back to articles</a></p>
{:else if saved}
  {@const s = saved}
  <h1>{s.title}</h1>
  <p class="muted smallcaps">Saved {savedOn(s)}</p>
  <dl class="card">
    {#if s.author}<dt class="muted smallcaps">Author</dt><dd>{s.author}</dd>{/if}
    <dt class="muted smallcaps">Site</dt><dd>{s.domain}</dd>
    <dt class="muted smallcaps">Reading time</dt><dd data-testid="reading-time">{minutesLabel(s)}</dd>
  </dl>
  <div class="actions">
    <button class="primary" type="button" onclick={() => void markArticleRead(s.id)}>Mark as read</button>
    <a class="button" href={s.url} target="_blank" rel="noopener noreferrer">Open page</a>
    <button class="danger" type="button" onclick={() => (removing = true)}>Remove article</button>
  </div>
  <HighlightList itemId={s.id} url={s.url} />
  {#if removing}
    <Confirm title="Remove this article?" body="It disappears from every view." confirmLabel="Remove" danger onconfirm={() => void remove()} oncancel={() => (removing = false)} />
  {/if}
{:else if article}
  {@const a = article}
  {#if editing}
    <form class="card" onsubmit={(e) => void save(e, a)}>
      <label for="edit-title">Title</label>
      <input id="edit-title" type="text" bind:value={title} />
      <label for="edit-author">Author</label>
      <input id="edit-author" type="text" bind:value={author} />
      <label for="edit-read-on">Date read</label>
      <input id="edit-read-on" type="date" bind:value={readOn} />
      <div class="actions">
        <button class="primary" type="submit">Save</button>
        <button type="button" onclick={() => (editing = false)}>Cancel</button>
      </div>
      <p role="alert" class="error">{error ?? ''}</p>
    </form>
  {:else}
    <h1>{a.title}</h1>
    <dl class="card">
      {#if a.author}<dt class="muted smallcaps">Author</dt><dd>{a.author}</dd>{/if}
      <dt class="muted smallcaps">Site</dt><dd>{a.domain}</dd>
      <dt class="muted smallcaps">Read on</dt><dd>{longDate(a.readOn)}</dd>
      <dt class="muted smallcaps">Reading time</dt><dd data-testid="reading-time">{minutesLabel(a)}</dd>
    </dl>
    {#if a.detailsStatus === 'notFound'}<p class="muted">Details not fetched</p>{/if}
    <div class="actions">
      <a class="button" href={a.url} target="_blank" rel="noopener noreferrer">Open page</a>
      <button type="button" onclick={() => startEditing(a)}>Edit</button>
      <button class="danger" type="button" onclick={() => (removing = true)}>Remove article</button>
    </div>
    <HighlightList itemId={a.id} url={a.url} />
  {/if}
  {#if removing}
    <Confirm title="Remove this article?" body="It disappears from every view." confirmLabel="Remove" danger onconfirm={() => void remove()} oncancel={() => (removing = false)} />
  {/if}
{/if}

<style>
  dl { margin: 0 0 12px; }
  dt { font-size: 0.85rem; margin-top: 8px; }
  dd { margin: 0; overflow-wrap: anywhere; }
</style>
