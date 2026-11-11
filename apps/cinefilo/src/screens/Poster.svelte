<script lang="ts">
  import { covers } from '../lib/covers.svelte.ts';
  import { posterObjectUrl } from '../lib/posters.ts';
  import Cover from './Cover.svelte';

  let { titleId, path, hero = false }: { titleId: string; path: string | null; hero?: boolean } = $props();

  let url = $state<string | null>(null);

  // Posters are fetched only when the device asked for them; the generated cover is the default and the fallback (D5).
  $effect(() => {
    const id = titleId;
    const p = path;
    const wanted = covers.mode === 'posters';
    let stale = false;
    url = null;
    if (wanted) {
      void posterObjectUrl(id, p).then((u) => {
        if (!stale) url = u;
      });
    }
    return () => (stale = true);
  });
</script>

{#if covers.mode === 'posters' && url}
  <!-- Decorative: the title is always written next to it. -->
  <img class="poster" class:hero src={url} alt="" data-testid="poster-img" />
{:else}
  <Cover {titleId} {hero} />
{/if}
