<script lang="ts">
  import { dayNumber, type LocalDate } from '@readerlog/core';
  import type { StatsView } from '@readerlog/core';
  import { monthAbbr, shortDate } from '../lib/dates.ts';

  let { cells }: { cells: StatsView['heatmap'] } = $props();

  type Cell = StatsView['heatmap'][number];

  const label = (c: Cell) =>
    c.level === 0
      ? `${shortDate(c.date)}: no reading`
      : c.pages > 0
        ? `${shortDate(c.date)}: ${c.pages} ${c.pages === 1 ? 'page' : 'pages'}`
        : `${shortDate(c.date)}: read, no pages logged`;

  // Weeks run Monday to Sunday. 1970-01-01 (day 0) was a Thursday, so Monday = 0 is (n + 3) % 7.
  const weeks = $derived.by(() => {
    const out: { month: string; cells: (Cell | null)[] }[] = [];
    let col: (Cell | null)[] = [];
    let month = '';
    const first = cells[0];
    if (first) col = Array.from({ length: (dayNumber(first.date as LocalDate) + 3) % 7 }, () => null);
    for (const c of cells) {
      if (c.date.endsWith('-01') || (c === first && month === '')) month = monthAbbr(Number(c.date.slice(5, 7)));
      col.push(c);
      if (col.length === 7) {
        out.push({ month, cells: col });
        col = [];
        month = '';
      }
    }
    if (col.length > 0) {
      while (col.length < 7) col.push(null);
      out.push({ month, cells: col });
    }
    return out;
  });
</script>

<div class="scroll">
  <div class="grid">
    {#each weeks as w, i (i)}
      <div class="week">
        <span class="month">{w.month}</span>
        {#each w.cells as c, j (j)}
          {#if c}
            <span class="cell l{c.level}" role="img" aria-label={label(c)}></span>
          {:else}
            <span class="cell pad" aria-hidden="true"></span>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .scroll { overflow-x: auto; padding-bottom: 6px; }
  .grid {
    display: flex; gap: 3px; width: max-content;
  }
  .week { display: grid; grid-template-rows: 14px repeat(7, 12px); gap: 3px; }
  .month { font-size: 0.7rem; color: var(--muted); white-space: nowrap; overflow: visible; line-height: 14px; }
  .cell { width: 12px; height: 12px; border-radius: 2px; }
  .pad { visibility: hidden; }
  .l0 { background: var(--heat-0); }
  .l1 { background: var(--heat-1); }
  .l2 { background: var(--heat-2); }
  .l3 { background: var(--heat-3); }
  .l4 { background: var(--heat-4); }
</style>
