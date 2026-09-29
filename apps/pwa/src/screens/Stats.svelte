<script lang="ts">
  import type { StatsView } from '@readerlog/core';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { reportError } from '../lib/errors.ts';
  import { longDate } from '../lib/dates.ts';
  import Heatmap from './Heatmap.svelte';

  let year = $state(Number(todayLocal().slice(0, 4)));
  let view = $state<StatsView | null>(null);

  async function load() {
    const r = await query({ name: 'stats', year, today: todayLocal() });
    if (r.ok) view = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
</script>

<h1>Stats</h1>

{#if view}
  {@const v = view}
  <h2 class="headline">{plural(v.summary.readingDays, 'reading day')} in {v.year}</h2>

  <label for="stats-year">Year</label>
  <select id="stats-year" bind:value={year}>
    {#each v.years as y (y)}<option value={y}>{y}</option>{/each}
  </select>

  <div class="card">
    <Heatmap cells={v.heatmap} />
  </div>

  <p>Current streak: {plural(v.current?.length ?? 0, 'day')}</p>
  <p>Longest streak: {plural(v.longest?.length ?? 0, 'day')}{v.longest ? ` (${longDate(v.longest.start)} – ${longDate(v.longest.end)})` : ''}</p>

  {#if !v.hasAnyEvents}
    <p class="muted">Log reading from a book to see stats here.</p>
  {/if}
{/if}

<style>
  .headline { font-size: 1.2rem; color: var(--text); text-transform: none; letter-spacing: 0; margin-top: 0; }
</style>
