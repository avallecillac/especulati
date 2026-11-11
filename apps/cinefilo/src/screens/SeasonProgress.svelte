<script lang="ts">
  import { theme } from '../lib/appearance.svelte.ts';

  /** Where a series stands, drawn per theme: Béton a 16-cell grid, Willis one bar per season (at most 12). Decorative. */
  let { current, total }: { current: number; total: number } = $props();

  const beton = $derived(theme.id === 'beton');
  const cells = $derived(16);
  const n = $derived(Math.min(total, 12));
  const filled = $derived(Math.max(0, Math.min(beton ? cells : n, Math.round((current / total) * (beton ? cells : n)))));
  const count = $derived(beton ? cells : n);
</script>

<span class="progress" class:grid={beton} aria-hidden="true" data-testid="season-progress">
  {#each Array.from({ length: count }, (_, k) => k) as k (k)}
    <span class="cell" class:on={k < filled} class:last={k === filled - 1}></span>
  {/each}
</span>
