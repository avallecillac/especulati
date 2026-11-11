<script lang="ts">
  import type { DetailsStatus } from '@especulati/lector-core';

  let { status }: { status: DetailsStatus } = $props();
</script>

{#if status === 'pending'}
  <span class="muted badge">Details pending</span>
{:else if status === 'notFound'}
  <span class="muted badge">Details not found</span>
{/if}
