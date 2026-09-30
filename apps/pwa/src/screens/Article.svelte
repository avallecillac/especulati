<script lang="ts">
  import { untrack } from 'svelte';
  import { readingMinutes, type Article } from '@readerlog/core';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { longDate } from '../lib/dates.ts';
  import { errorMessage, reportError } from '../lib/errors.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import Confirm from './Confirm.svelte';

  let props: { id: string } = $props();
  // The route is keyed on the id ({#key} in App.svelte).
  const id = untrack(() => props.id);

  let article = $state<Article | null | undefined>(undefined);
  let editing = $state(false);
  let removing = $state(false);
  let title = $state('');
  let author = $state('');
  let readOn = $state('');
  let error = $state<string | null>(null);

  async function load() {
    const r = await query({ name: 'article', itemId: id });
    if (r.ok) article = r.value;
    else reportError(r.error);
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
    const r = await dispatch({ kind: 'RemoveArticle', itemId: id });
    if (!r.ok) return reportError(r.error);
    showToast('Article removed');
    navigate('/articles');
  }

  function minutesLabel(a: Article): string {
    const m = readingMinutes(a.wordCount);
    return m === null ? '—' : `~${m} min`;
  }
</script>

{#if article === null}
  <p class="muted">This article no longer exists. <a href="#/articles">Back to articles</a></p>
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
