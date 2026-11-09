<script lang="ts">
  import { normalizeUrl, readingMinutes, siteOf, type Article } from '@readerlog/core';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { longDate } from '../lib/dates.ts';
  import { errorMessage, reportError } from '../lib/errors.ts';
  import Butterfly from '../ornaments/Butterfly.svelte';
  import { navigate } from '../lib/router.svelte.ts';

  let { onsaved }: { onsaved?: () => void } = $props();

  const PAGE = 100;

  let articles = $state<Article[] | null>(null);
  let hasMore = $state(false);

  // One extra row tells us whether there is another page (keyset paging, research R10b).
  async function load() {
    const want = Math.max(PAGE, articles?.length ?? 0);
    const r = await query({ name: 'articles', limit: want + 1 });
    if (!r.ok) return reportError(r.error);
    hasMore = r.value.length > want;
    articles = r.value.slice(0, want);
  }

  async function showMore() {
    const last = articles?.at(-1);
    if (!last) return;
    const r = await query({ name: 'articles', limit: PAGE + 1, before: { readOn: last.readOn, createdAt: last.createdAt, id: last.id } });
    if (!r.ok) return reportError(r.error);
    hasMore = r.value.length > PAGE;
    articles = [...(articles ?? []), ...r.value.slice(0, PAGE)];
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  function minutesLabel(a: Article): string {
    const m = readingMinutes(a.wordCount);
    return m === null ? '—' : `~${m} min`;
  }

  // Add article (a manual add: no details are fetched).
  let adding = $state(false);
  let url = $state('');
  let title = $state('');
  let titleTouched = $state(false);
  let readOn = $state(todayLocal());
  let later = $state(false);
  let error = $state<string | null>(null);
  let loggedOn = $state<string | null>(null);

  const norm = $derived(normalizeUrl(url));
  const site = $derived(norm.ok ? siteOf(norm.value) : '');

  $effect(() => {
    if (!titleTouched) title = site;
  });

  // Warn (do not block) when the address is already logged (FR-008).
  $effect(() => {
    const n = norm;
    let stale = false;
    loggedOn = null;
    if (n.ok) {
      void query({ name: 'findArticleByUrl', url: n.value }).then((r) => {
        if (!stale && r.ok && r.value[0]) loggedOn = r.value[0].readOn;
      });
    }
    return () => (stale = true);
  });

  function startAdding() {
    url = '';
    title = '';
    titleTouched = false;
    readOn = todayLocal();
    later = false;
    error = null;
    adding = true;
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!norm.ok) return void (error = errorMessage({ kind: 'InvalidUrl' }));
    const itemId = crypto.randomUUID();
    const r = await dispatch({
      kind: 'AddArticle',
      itemId,
      url: norm.value,
      title: title.trim() === '' ? site : title,
      author: null,
      wordCount: null,
      ...(later ? {} : { readOn }),
      detailsStatus: 'notFound',
    });
    if (!r.ok) return void (error = errorMessage(r.error));
    adding = false;
    // A saved article has no page of its own: show it in the Saved list.
    if (later) onsaved?.();
    else navigate(`/article/${itemId}`);
  }
</script>

{#if adding}
  <form class="card" onsubmit={save}>
    <label for="article-url">Web address</label>
    <input id="article-url" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={url} />
    {#if loggedOn}<p class="muted" role="status">Already logged on {longDate(loggedOn)}.</p>{/if}
    <label for="article-title">Title</label>
    <input id="article-title" type="text" bind:value={title} oninput={() => (titleTouched = true)} />
    <label class="check"><input type="checkbox" bind:checked={later} /> Read later</label>
    {#if !later}
      <label for="article-read-on">Date read</label>
      <input id="article-read-on" type="date" bind:value={readOn} />
    {/if}
    <div class="actions">
      <button class="primary" type="submit">Save article</button>
      <button type="button" onclick={() => (adding = false)}>Cancel</button>
    </div>
    <p role="alert" class="error">{error ?? ''}</p>
  </form>
{:else}
  <div class="actions"><button type="button" onclick={startAdding}>Add article</button></div>
{/if}

{#if articles}
  {#if articles.length === 0}
    <div class="vignette">
      <Butterfly size={40} />
      <p class="muted">No articles yet.</p>
    </div>
  {:else}
    <ul class="plain" aria-label="Articles">
      {#each articles as a (a.id)}
        <li data-testid="article-row">
          <div class="article-main">
            <a class="article-title" href={`#/article/${a.id}`}>{a.title}</a>
            <span class="muted smallcaps">{a.domain} · {a.readOn}</span>
          </div>
          <span class="spacer"></span>
          <span class="muted mins">{minutesLabel(a)}</span>
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <div class="actions"><button type="button" onclick={() => void showMore()}>Show more</button></div>
    {/if}
  {/if}
{/if}

<style>
  .actions + :is(ul, .vignette), form + :is(ul, .vignette) { margin-top: 14px; }
  .mins { font-style: italic; font-size: 0.9rem; white-space: nowrap; }
</style>
