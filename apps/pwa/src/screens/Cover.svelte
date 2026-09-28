<script lang="ts">
  import { onChanged } from '../lib/dbClient.ts';
  import { coverObjectUrl } from '../lib/covers.ts';
  import { coverHue, initials } from '../lib/coverArt.ts';

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
  <div class="cover {size} generated" role="img" aria-label={label} style:background={`hsl(${coverHue(title)} 45% 45%)`}>
    <span aria-hidden="true">{initials(title)}</span>
  </div>
{/if}
