<script lang="ts">
  import { VERDICT_FILTERS, type VerdictFilter } from '@especulati/cinefilo-core';
  import type { ListItem, ListScope, ListTab, PendingRecommendation } from '@especulati/cinefilo-db';
  import { list, pendingRecommendations } from '../lib/dbClient.ts';
  import { listView } from '../lib/listView.svelte.ts';
  import { FILTER_LABEL, KIND_LABEL, VERDICT_LABEL } from '../lib/labels.ts';
  import { app, showToast, write } from '../lib/state.svelte.ts';
  import Poster from './Poster.svelte';
  import SeasonProgress from './SeasonProgress.svelte';
  import Verdict from './Verdict.svelte';

  let { tab, onadd }: { tab: ListTab; onadd: () => void } = $props();

  const HEADING: Record<ListTab, string> = { later: 'Watch later', watching: 'Watching', watched: 'Watched' };

  let filter = $state<VerdictFilter | null>(null);
  let items = $state<ListItem[] | null>(null);
  let recs = $state<PendingRecommendation[]>([]);
  const scope = $derived(listView.scope);
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

  function detail(i: ListItem): string {
    const parts: string[] = [KIND_LABEL[i.kind]];
    if (i.year) parts.push(String(i.year));
    if (i.status === 'watching' && i.currentSeason) parts.push(`Season ${i.currentSeason}`);
    if (i.status === 'dropped') parts.push('Dropped');
    if (i.watchedOn) parts.push(i.watchedOn);
    return parts.join(' · ');
  }
</script>

<div class="seg choice list-switch" role="radiogroup" aria-label="List">
  {#each choices as c, i (c.id)}
    {@const on = scope === c.id}
    <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} data-choice={c.id} onclick={() => pick(c.id)} onkeydown={(e) => onKey(e, i)}>{c.label}</button>
  {/each}
</div>

<div class="list-frame" data-scope={scope}>
<header class="bar">
  <div>
    <h1>{HEADING[tab]}</h1>
    <p class="whose" data-testid="whose">{whose}</p>
  </div>
  <button class="primary" type="button" onclick={onadd}>Add</button>
</header>

<div class="chips" role="group" aria-label="Filter by verdict">
  {#each VERDICT_FILTERS as f (f)}
    <button type="button" class="chip" aria-pressed={filter === f} onclick={() => (filter = filter === f ? null : f)}>{FILTER_LABEL[f]}</button>
  {/each}
</div>

{#if recs.length > 0 && !filter}
  <ul class="rows recs" aria-label="Recommended to you">
    {#each recs as r (r.id)}
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
{:else if items.length === 0}
  {#if recs.length === 0 || filter}
    <p class="empty">{filter ? 'Nothing matches this filter.' : scope === 'partner' ? `${partner} has nothing here yet.` : scope === 'me' ? 'Nothing here yet. Tap Add and choose Just me.' : 'Nothing here yet. Tap Add to put a movie or series on the list.'}</p>
  {/if}
{:else}
  <ul class="rows">
    {#each items as i (i.id)}
      <li>
        <a class="row" href={`#/title/${encodeURIComponent(i.id)}`}>
          <Poster titleId={i.id} path={i.posterUrl} />
          <span class="meta">
            <span class="name">{i.title}</span>
            <span class="muted small">{detail(i)}</span>
            {#if i.kind === 'series' && i.status === 'watching' && i.currentSeason && i.seasonCount}
              <SeasonProgress current={i.currentSeason} total={i.seasonCount} />
            {/if}
          </span>
          <span class="verdicts">
            {#if i.mine === 'like' && i.partner === 'like'}<span class="both" role="img" aria-label="You both loved it"></span>{/if}
            <span class="pair"><span class="who" aria-hidden="true">{myInitial}</span><Verdict v={i.mine} label={`You: ${i.mine ? VERDICT_LABEL[i.mine] : 'not rated'}`} /></span>
            <span class="pair"><span class="who" aria-hidden="true">{partnerInitial}</span><Verdict v={i.partner} label={`${partner}: ${i.partner ? VERDICT_LABEL[i.partner] : 'not rated'}`} /></span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
</div>
