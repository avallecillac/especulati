<script lang="ts">
  import { HERO_BOX, THUMB_BOX, coverSpec } from '../lib/coverArt.ts';
  import { theme } from '../lib/appearance.svelte.ts';

  let { titleId, hero = false }: { titleId: string; hero?: boolean } = $props();

  const box = $derived(hero ? HERO_BOX : THUMB_BOX);
  const spec = $derived(coverSpec(titleId, theme.id, box));
</script>

<!-- Decorative: the title is always written next to it. -->
<svg class="cover" class:hero viewBox={`0 0 ${spec.box.w} ${spec.box.h}`} preserveAspectRatio={hero ? 'xMidYMid slice' : 'none'} aria-hidden="true" focusable="false" data-testid="cover">
  {#each spec.shapes as s, n (n)}
    <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={`var(--${s.token})`} opacity={s.opacity} />
  {/each}
  {#if hero && theme.id === 'beton'}
    <text x="20" y={spec.box.h - 12} font-size="10" fill="var(--ink-soft)" style="font-family: var(--font-label)">SECTION A–A · 1:200</text>
  {/if}
</svg>
