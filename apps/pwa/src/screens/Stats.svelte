<script lang="ts">
  import type { ArticleStats, StatsView } from '@readerlog/core';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { reportError } from '../lib/errors.ts';
  import { longDate, monthAbbr } from '../lib/dates.ts';
  import Heatmap from './Heatmap.svelte';

  let year = $state(Number(todayLocal().slice(0, 4)));
  let view = $state<StatsView | null>(null);
  let articles = $state<ArticleStats | null>(null);
  let scope = $state<'year' | 'all'>('year');

  async function load() {
    const today = todayLocal();
    const [r, a] = await Promise.all([query({ name: 'stats', year, today }), query({ name: 'articleStats', year, today })]);
    if (r.ok) view = r.value;
    else reportError(r.error);
    if (a.ok) articles = a.value;
    else reportError(a.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  const hoursMinutes = (minutes: number) => `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
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

  <section class="card" aria-labelledby="totals-title">
    <h2 id="totals-title">Books and pages</h2>
    <div class="row">
      <button aria-pressed={scope === 'year'} class:primary={scope === 'year'} onclick={() => (scope = 'year')}>{v.year}</button>
      <button aria-pressed={scope === 'all'} class:primary={scope === 'all'} onclick={() => (scope = 'all')}>All time</button>
    </div>
    {#if scope === 'year'}
      <p>Books finished: <span data-testid="books-finished">{v.summary.booksFinished}</span></p>
      <p>Pages read: <span data-testid="pages-read">{v.summary.pages}</span></p>
      <p>Pages per reading day: <span data-testid="pages-per-day">{v.summary.pagesPerReadingDay ?? '—'}</span></p>
      <table aria-label="Books and pages per month">
        <thead><tr><th scope="col">Month</th><th scope="col">Books</th><th scope="col">Pages</th></tr></thead>
        <tbody>
          {#each v.summary.months as m (m.month)}
            <tr><th scope="row">{monthAbbr(m.month)}</th><td>{m.booksFinished}</td><td>{m.pages}</td></tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <table aria-label="All time">
        <thead><tr><th scope="col">Year</th><th scope="col">Reading days</th><th scope="col">Books</th><th scope="col">Pages</th></tr></thead>
        <tbody>
          {#each v.allTime as r (r.year)}
            <tr><th scope="row">{r.year}</th><td>{r.readingDays}</td><td>{r.booksFinished}</td><td>{r.pages}</td></tr>
          {:else}
            <tr><td colspan="4" class="muted">No reading yet.</td></tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

{#if view && articles}
  {@const a = articles}
  <section class="card" aria-labelledby="article-stats-title">
    <h2 id="article-stats-title">Articles</h2>
    <p>This week: <span data-testid="articles-week">{a.thisWeek}</span></p>
    <p>This month: <span data-testid="articles-month">{a.thisMonth}</span></p>
    <p>Reading time in {view.year}: <span data-testid="articles-time">{hoursMinutes(a.minutes)}</span></p>
    <ul class="plain months" aria-label="Articles per month">
      {#each a.months as m (m.month)}
        <li><span class="muted">{monthAbbr(m.month)}</span> <span data-testid={`articles-month-${m.month}`}>{m.count}</span></li>
      {/each}
    </ul>
    {#if a.topSites.length > 0}
      <h3>Top sites</h3>
      <ol aria-label="Top sites">
        {#each a.topSites as s (s.domain)}<li>{s.domain} ({s.count})</li>{/each}
      </ol>
    {/if}
  </section>
{/if}

<style>
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 2px 8px 2px 0; }
  .months { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px 8px; }
  .months li { display: block; padding: 0; border: 0; }
  .headline { font-size: 1.2rem; color: var(--text); text-transform: none; letter-spacing: 0; margin-top: 0; }
</style>
