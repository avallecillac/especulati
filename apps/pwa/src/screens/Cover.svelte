<script lang="ts">
  import { onChanged } from '../lib/dbClient.ts';
  import { coverObjectUrl } from '../lib/covers.ts';
  import { coverCloth, initials } from '../lib/coverArt.ts';
  import Fleuron from '../ornaments/Fleuron.svelte';

  let { itemId, hasCover = false, url = null, title, size }: {
    itemId?: string;
    hasCover?: boolean;
    url?: string | null;
    title: string;
    size: 'sm' | 'md';
  } = $props();

  let stored = $state<string | null>(null);
  let version = $state(0);
  let failed = $state<string | null>(null);

  $effect(() => onChanged(() => version++));

  $effect(() => {
    void version;
    const id = itemId;
    if (!id || !hasCover) {
      stored = null;
      return;
    }
    let cancelled = false;
    void coverObjectUrl(id).then((u) => {
      if (!cancelled) stored = u;
    });
    return () => {
      cancelled = true;
    };
  });

  const src = $derived(itemId && hasCover ? stored : url || null);
  const label = $derived(`Cover of ${title}`);
</script>

{#if src && failed !== src}
  <img class="cover {size}" {src} alt={label} onerror={() => (failed = src)} />
{:else}
  <div class="cover {size} generated" role="img" aria-label={label} style:background={`var(--cloth-${coverCloth(title)})`}>
    <span class="frame" aria-hidden="true"></span>
    <span class="label" aria-hidden="true">{initials(title)}</span>
    {#if size === 'md'}<span class="mark" aria-hidden="true"><Fleuron size={12} /></span>{/if}
  </div>
{/if}

<style>
  .generated { position: relative; flex-direction: column; gap: 6px; }
  .frame { position: absolute; inset: 3px; border: 1px solid color-mix(in srgb, var(--on-cloth) 40%, transparent); border-radius: 2px; pointer-events: none; }
  .label {
    position: relative; width: 70%; padding: 0.15em 0; text-align: center;
    background: var(--leaf); color: var(--ink); font-family: var(--font-display); font-weight: 600; line-height: 1.1;
    letter-spacing: 0.04em; white-space: nowrap; overflow: hidden;
  }
  .mark { position: relative; line-height: 0; }
  .mark :global(.ornament) { color: var(--on-cloth); }
</style>
