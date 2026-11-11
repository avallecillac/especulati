<script lang="ts">
  import { posterObjectUrl } from '../lib/posters.ts';
  import { coverCloth } from '../lib/posterArt.ts';

  let { titleId, title, path, big = false }: { titleId: string; title: string; path: string | null; big?: boolean } = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    const id = titleId;
    const p = path;
    let stale = false;
    url = null;
    void posterObjectUrl(id, p).then((u) => {
      if (!stale) url = u;
    });
    return () => (stale = true);
  });
</script>

{#if url}
  <!-- Decorative: the title is always written next to it. -->
  <img class="poster" class:big src={url} alt="" data-testid="poster-img" />
{:else}
  <span class={`poster tile cloth-${coverCloth(titleId)}`} class:big aria-hidden="true">{title.trim().slice(0, 1).toUpperCase() || '#'}</span>
{/if}
