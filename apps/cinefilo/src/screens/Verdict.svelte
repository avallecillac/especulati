<script lang="ts">
  import type { Verdict } from '@especulati/cinefilo-core';

  /** The verdict mark (D7): one element, styled per theme in theme/details.css. `label` is its accessible name. */
  let { v, label, decorative = false }: { v: Verdict | null; label?: string; decorative?: boolean } = $props();
</script>

{#if decorative}
  <span class="vmark" data-v={v ?? 'none'} aria-hidden="true"></span>
{:else}
  <span class="vmark" data-v={v ?? 'none'} role="img" aria-label={label}></span>
{/if}
