<script lang="ts">
  import { onMount } from 'svelte';
  import { VERDICT_FILTERS, type VerdictFilter } from '@especulati/cinefilo-core';
  import { FILTER_LABEL } from '../lib/labels.ts';

  let { filter, onpick, onclose }: { filter: VerdictFilter | null; onpick: (f: VerdictFilter | null) => void; onclose: () => void } = $props();

  const choices = $derived<{ id: VerdictFilter | null; label: string }[]>([
    { id: null, label: 'All' },
    ...VERDICT_FILTERS.map((f) => ({ id: f, label: FILTER_LABEL[f] })),
  ]);
  let group = $state<HTMLElement>();

  // Focus the chosen radio when the sheet opens, and give focus back to whatever opened it when it closes.
  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => opener?.focus();
  });

  // Roving focus: arrows move between the options, Enter or Space picks the focused one (a pick closes the sheet).
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const buttons = group?.querySelectorAll<HTMLElement>('[role="radio"]');
    buttons?.[(i + step + choices.length) % choices.length]?.focus();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Filter">
  <div class="grabber" aria-hidden="true"></div>
  <h2>Filter by verdict</h2>
  <div class="filter-options" role="radiogroup" aria-label="Verdict" bind:this={group}>
    {#each choices as c, i (c.id ?? 'all')}
      {@const on = filter === c.id}
      <button type="button" role="radio" aria-checked={on} tabindex={on ? 0 : -1} onclick={() => onpick(c.id)} onkeydown={(e) => onKey(e, i)}>{c.label}</button>
    {/each}
  </div>
</div>
