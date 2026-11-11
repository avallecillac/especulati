<script lang="ts">
  import { VERDICT_FILTERS, type VerdictFilter } from '@especulati/cinefilo-core';
  import type { ListItem, ListTab } from '@especulati/cinefilo-db';
  import { list } from '../lib/dbClient.ts';
  import { FILTER_LABEL, KIND_LABEL, VERDICT_LABEL } from '../lib/labels.ts';
  import { app } from '../lib/state.svelte.ts';
  import Poster from './Poster.svelte';
  import SeasonProgress from './SeasonProgress.svelte';
  import Verdict from './Verdict.svelte';

  let { tab, onadd }: { tab: ListTab; onadd: () => void } = $props();

  const HEADING: Record<ListTab, string> = { later: 'Watch later', watching: 'Watching', watched: 'Watched' };

  let filter = $state<VerdictFilter | null>(null);
  let items = $state<ListItem[] | null>(null);
  const partner = $derived(app.members.find((m) => !m.me)?.name ?? 'Partner');
  const initial = (n: string) => (n.trim().charAt(0) || '?').toUpperCase();
  const myInitial = $derived(initial(app.members.find((m) => m.me)?.name ?? 'Me'));
  const partnerInitial = $derived(initial(partner));

  // Reload whenever anything was written, or the filter changes. `rev` is read to subscribe.
  $effect(() => {
    void app.rev;
    const f = filter;
    let stale = false;
    void list(tab, f ?? undefined).then((r) => {
      if (!stale && r.ok) items = r.value;
    });
    return () => (stale = true);
  });

  function detail(i: ListItem): string {
    const parts: string[] = [KIND_LABEL[i.kind]];
    if (i.year) parts.push(String(i.year));
    if (i.status === 'watching' && i.currentSeason) parts.push(`Season ${i.currentSeason}`);
    if (i.status === 'dropped') parts.push('Dropped');
    if (i.watchedOn) parts.push(i.watchedOn);
    return parts.join(' · ');
  }
</script>

<header class="bar">
  <h1>{HEADING[tab]}</h1>
  <button class="primary" type="button" onclick={onadd}>Add</button>
</header>

<div class="chips" role="group" aria-label="Filter by verdict">
  {#each VERDICT_FILTERS as f (f)}
    <button type="button" class="chip" aria-pressed={filter === f} onclick={() => (filter = filter === f ? null : f)}>{FILTER_LABEL[f]}</button>
  {/each}
</div>

{#if items === null}
  <p class="muted">Loading</p>
{:else if items.length === 0}
  <p class="empty">{filter ? 'Nothing matches this filter.' : 'Nothing here yet. Tap Add to put a movie or series on the list.'}</p>
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
