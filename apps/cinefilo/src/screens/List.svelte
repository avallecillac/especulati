<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { VerdictFilter } from '@especulati/cinefilo-core';
  import type { ListItem, ListScope, ListTab, PendingRecommendation } from '@especulati/cinefilo-db';
  import { list, pendingRecommendations } from '../lib/dbClient.ts';
  import { display, setLayout, setWatchedOrder } from '../lib/layout.svelte.ts';
  import { listView } from '../lib/listView.svelte.ts';
  import { FILTER_LABEL, KIND_LABEL, VERDICT_LABEL } from '../lib/labels.ts';
  import { matchesQuery } from '../lib/search.ts';
  import { app, showToast, write } from '../lib/state.svelte.ts';
  import FilterSheet from './FilterSheet.svelte';
  import Poster from './Poster.svelte';
  import SeasonProgress from './SeasonProgress.svelte';
  import Verdict from './Verdict.svelte';

  let { tab, onadd }: { tab: ListTab; onadd: () => void } = $props();

  const HEADING: Record<ListTab, string> = { later: 'Watch later', watching: 'Watching', watched: 'Watched' };

  let filtering = $state(false);
  let items = $state<ListItem[] | null>(null);
  let recs = $state<PendingRecommendation[]>([]);
  const scope = $derived(listView.scope);
  const filter = $derived(listView.filter);
  const query = $derived(listView.query);
  const partnerMember = $derived(app.members.find((m) => !m.me) ?? null);
  const partner = $derived(partnerMember?.name ?? 'Partner');
  const meName = $derived(app.members.find((m) => m.me)?.name ?? 'Me');
  const initial = (n: string) => (n.trim().charAt(0) || '?').toUpperCase();
  const myInitial = $derived(initial(app.members.find((m) => m.me)?.name ?? 'Me'));
  const partnerInitial = $derived(initial(partner));

  // Reload whenever anything was written, or the filter changes. `rev` is read to subscribe.
  $effect(() => {
    void app.rev;
    const f = filter;
    const sc = scope;
    let stale = false;
    void list(tab, f ?? undefined, sc).then((r) => {
      if (!stale && r.ok) items = r.value;
    });
    // Recommendations to me wait at the top of my own Watch later.
    if (sc === 'me' && tab === 'later') {
      void pendingRecommendations().then((r) => {
        if (!stale && r.ok) recs = r.value;
      });
    } else recs = [];
    return () => (stale = true);
  });

  // Keep the place (cinefilo-compact-lists D5): remember where each list is scrolled, and put it back after the first load.
  // Nothing is saved until the list has loaded and been restored, so the page shrinking on the way in cannot overwrite it.
  const placeKey = () => `${tab}:${listView.scope}`;
  let tracking = false;
  let restored = false;
  let lastY = 0;
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (tracking) listView.scroll[placeKey()] = lastY;
  };

  onMount(() => {
    const onScroll = () => {
      lastY = window.scrollY;
      if (tracking && frame === 0) frame = requestAnimationFrame(flush);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
      flush();
    };
  });

  $effect(() => {
    if (items === null || restored) return;
    restored = true;
    const saved = untrack(() => listView.scroll[placeKey()]);
    if (!saved) {
      tracking = true;
      return;
    }
    void tick().then(() => requestAnimationFrame(() => {
      window.scrollTo(0, saved);
      lastY = window.scrollY;
      tracking = true;
    }));
  });

  const choices = $derived<{ id: ListScope; label: string }[]>([
    { id: 'together', label: 'Together' },
    { id: 'me', label: meName },
    ...(partnerMember ? [{ id: 'partner' as const, label: partner }] : []),
  ]);
  const whose = $derived(scope === 'me' ? 'Your list' : scope === 'partner' ? `${partner}'s list \u00b7 view only` : 'Together');

  function pick(id: ListScope) {
    if (listView.scope === id) return;
    listView.scope = id;
    items = null;
  }

  // Radio group: arrows move the choice and the focus together.
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = choices[(i + step + choices.length) % choices.length]!.id;
    pick(next);
    (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
  }

  async function answer(r: PendingRecommendation, a: 'accepted' | 'dismissed') {
    const res = await write({ kind: 'AnswerRecommendation', id: r.id, titleId: r.titleId, answer: a });
    if (res.ok) showToast(a === 'accepted' ? `Added ${r.title} to your Watch later.` : `Dismissed ${r.title}.`);
    else showToast('Could not save. Try again.');
  }

  // The numbered Together history comes newest first; "From #1" flips just that part (unnumbered titles stay after it).
  const shown = $derived.by(() => {
    if (items === null || scope !== 'together' || tab !== 'watched' || display.watchedOrder !== 'first') return items;
    return [...items.filter((i) => i.watchOrder !== null).reverse(), ...items.filter((i) => i.watchOrder === null)];
  });
  /** What is on screen: the ordered list narrowed by the search (D2). */
  const visible = $derived(shown === null ? null : shown.filter((i) => matchesQuery(i.title, query)));
  const visibleRecs = $derived(recs.filter((r) => matchesQuery(r.title, query)));
  const grid = $derived(display.layout === 'grid');

  function setFilter(f: VerdictFilter | null) {
    listView.filter = f;
    filtering = false;
  }

  /** `aria-label` of the review mark: who wrote a review (either member, or both). */
  function reviewLabel(i: ListItem): string | null {
    if (i.reviewedByMe && i.reviewedByPartner) return 'Reviewed by both';
    if (i.reviewedByMe) return `Reviewed by ${meName}`;
    if (i.reviewedByPartner) return `Reviewed by ${partner}`;
    return null;
  }

  function detail(i: ListItem): string {
    const parts: string[] = [KIND_LABEL[i.kind]];
    if (i.year) parts.push(String(i.year));
    if (i.status === 'watching' && i.currentSeason) parts.push(`Season ${i.currentSeason}`);
    if (i.status === 'dropped') parts.push('Dropped');
    if (i.watchedOn) parts.push(i.watchedOn);
    return parts.join(' · ');
  }
</script>

{#snippet reviewMark(label: string, both: boolean)}
  <span class="badge reviewed" role="img" aria-label={label}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v11H11l-5 4v-4H4z" /></svg>
    {#if both}<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16v11H11l-5 4v-4H4z" /></svg>{/if}
  </span>
{/snippet}

<div class="list-frame" data-scope={scope}>
<header class="bar">
  <div>
    <h1>{HEADING[tab]}</h1>
    <!-- Always in the DOM so screen readers hear whose list it is; shown only for the partner's. -->
    <p class="whose" class:visually-hidden={scope !== 'partner'} data-testid="whose">{whose}</p>
  </div>
  <div class="bar-actions">
    <div class="seg choice layout-toggle" role="radiogroup" aria-label="Layout">
      <button type="button" role="radio" aria-checked={!grid} aria-label="List" tabindex={grid ? -1 : 0} onclick={() => setLayout('list')}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <button type="button" role="radio" aria-checked={grid} aria-label="Grid" tabindex={grid ? 0 : -1} onclick={() => setLayout('grid')}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
      </button>
    </div>
    <button class="primary add-btn" type="button" onclick={onadd}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
      Add
    </button>
  </div>
</header>

<div class="seg choice list-switch" role="radiogroup" aria-label="List">
  {#each choices as c, i (c.id)}
    {@const on = scope === c.id}
    <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-choice={c.id} onclick={() => pick(c.id)} onkeydown={(e) => onKey(e, i)}>{c.label}</button>
  {/each}
</div>

<div class="tools">
  <div class="search">
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6" /><path d="M15 15l5 5" /></svg>
    <input type="search" aria-label="Search titles" placeholder="Search titles" autocomplete="off" bind:value={listView.query} />
    {#if query !== ''}
      <button type="button" class="clear" aria-label="Clear search" onclick={() => (listView.query = '')}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    {/if}
  </div>
  {#if scope === 'together' && tab === 'watched'}
    <div class="seg choice order-toggle" role="radiogroup" aria-label="Watched order">
      <button type="button" role="radio" aria-checked={display.watchedOrder === 'newest'} aria-label="Newest first" title="Newest first" tabindex={display.watchedOrder === 'newest' ? 0 : -1} onclick={() => setWatchedOrder('newest')}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
      </button>
      <button type="button" role="radio" aria-checked={display.watchedOrder === 'first'} aria-label="From #1" title="From #1" tabindex={display.watchedOrder === 'first' ? 0 : -1} onclick={() => setWatchedOrder('first')}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
      </button>
    </div>
  {/if}
  <button type="button" class="filter-btn" class:active={filter !== null} aria-label="Filter" aria-haspopup="dialog" aria-expanded={filtering} onclick={() => (filtering = true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
    Filter
    {#if filter !== null}<span class="dot" aria-hidden="true"></span>{/if}
  </button>
</div>

{#if filter !== null}
  <div class="active-filters">
    <button type="button" class="chip active" aria-label={`Remove filter ${FILTER_LABEL[filter]}`} onclick={() => (listView.filter = null)}>{FILTER_LABEL[filter]} &times;</button>
  </div>
{/if}

{#if filtering}
  <FilterSheet {filter} onpick={setFilter} onclose={() => (filtering = false)} />
{/if}

{#if visibleRecs.length > 0 && !filter}
  <ul class="rows recs" aria-label="Recommended to you">
    {#each visibleRecs as r (r.id)}
      <li class="rec">
        <a class="row" href={`#/title/${encodeURIComponent(r.titleId)}`}>
          <Poster titleId={r.titleId} path={r.posterUrl} />
          <span class="meta">
            <span class="name">{r.title}</span>
            <span class="muted small">{KIND_LABEL[r.kind]}{r.year ? ` \u00b7 ${r.year}` : ''}</span>
            <span class="small rec-from">Recommended by {r.fromName}</span>
          </span>
        </a>
        <div class="rec-actions">
          <button type="button" class="primary" aria-label={`Accept ${r.title}`} onclick={() => void answer(r, 'accepted')}>Accept</button>
          <button type="button" aria-label={`Dismiss ${r.title}`} onclick={() => void answer(r, 'dismissed')}>Dismiss</button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if items === null}
  <p class="muted">Loading</p>
{:else if visible === null || visible.length === 0}
  {#if query !== '' && items.length > 0 && visibleRecs.length === 0}
    <p class="empty">No titles match &ldquo;{query}&rdquo;.</p>
  {:else if recs.length === 0 || filter}
    <p class="empty">{filter ? 'Nothing matches this filter.' : scope === 'partner' ? `${partner} has nothing here yet.` : scope === 'me' ? 'Nothing here yet. Tap Add and choose Just me.' : 'Nothing here yet. Tap Add to put a movie or series on the list.'}</p>
  {/if}
{:else if grid}
  <ul class="grid" aria-label={HEADING[tab]}>
    {#each visible as i (i.id)}
      {@const rl = reviewLabel(i)}
      <li>
        <a class="tile" href={`#/title/${encodeURIComponent(i.id)}`} aria-label={i.title}>
          <Poster titleId={i.id} path={i.posterUrl} />
          {#if i.watchOrder !== null}<span class="badge num">#{i.watchOrder}</span>{/if}
          {#if rl}{@render reviewMark(rl, i.reviewedByMe && i.reviewedByPartner)}{/if}
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <ul class="rows">
    {#each visible as i (i.id)}
      {@const rl = reviewLabel(i)}
      <li>
        <a class="row" href={`#/title/${encodeURIComponent(i.id)}`}>
          <Poster titleId={i.id} path={i.posterUrl} />
          <span class="meta">
            <span class="name">{#if i.watchOrder !== null}<span class="num">#{i.watchOrder}</span>{' '}{/if}{i.title}</span>
            <span class="muted small">{detail(i)}</span>
            {#if i.kind === 'series' && i.status === 'watching' && i.currentSeason && i.seasonCount}
              <SeasonProgress current={i.currentSeason} total={i.seasonCount} />
            {/if}
            <!-- Under the title, not beside it, so long titles get the row's full width. -->
            <span class="verdicts">
              <span class="pair"><span class="who" aria-hidden="true">{myInitial}</span><Verdict v={i.mine} label={`You: ${i.mine ? VERDICT_LABEL[i.mine] : 'not rated'}`} /></span>
              <span class="pair"><span class="who" aria-hidden="true">{partnerInitial}</span><Verdict v={i.partner} label={`${partner}: ${i.partner ? VERDICT_LABEL[i.partner] : 'not rated'}`} /></span>
              {#if i.mine === 'like' && i.partner === 'like'}<span class="both" role="img" aria-label="You both loved it"></span>{/if}
              {#if rl}{@render reviewMark(rl, i.reviewedByMe && i.reviewedByPartner)}{/if}
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
</div>
