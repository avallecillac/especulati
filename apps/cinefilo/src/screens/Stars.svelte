<script lang="ts">
  import { starsText } from '../lib/labels.ts';

  /**
   * Half-star rating (cinefilo-stars D6). `value` is half stars, 1..10, or null. Editable: one slider, a tap or drag sets
   * the value from the pointer's x position and is written once on pointer up; keys write at once. Read-only: small
   * stars with `label` as the accessible name.
   */
  let { value, editable = false, label = '', onchange }: {
    value: number | null;
    editable?: boolean;
    label?: string;
    onchange?: (next: number | null) => void | Promise<unknown>;
  } = $props();

  const uid = $props.id();
  const STAR = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

  /** The value under the pointer while it is down (the preview); written on release. */
  let preview = $state<number | null>(null);
  /** The value just written, shown until the reloaded `value` arrives. */
  let pending = $state<number | null | undefined>(undefined);
  $effect(() => {
    void value;
    pending = undefined;
  });
  const shown = $derived(preview ?? (pending !== undefined ? pending : value));
  /** Fill of star `i` (0..4): 0, 0.5 or 1. */
  const fill = (i: number) => Math.min(1, Math.max(0, (shown ?? 0) / 2 - i));

  async function commit(next: number | null) {
    if (next === (pending !== undefined ? pending : value)) return;
    pending = next;
    await onchange?.(next);
  }

  const fromPointer = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.min(10, Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * 10)));
  };

  function down(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    preview = fromPointer(e);
  }
  function move(e: PointerEvent) {
    if (preview !== null) preview = fromPointer(e);
  }
  function up(e: PointerEvent) {
    if (preview === null) return;
    const next = fromPointer(e);
    preview = null;
    void commit(next);
  }

  function key(e: KeyboardEvent) {
    const cur = shown;
    let next: number | null | undefined;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur === null ? undefined : Math.max(1, cur - 1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(10, (cur ?? 0) + 1);
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = 10;
    else if (e.key === 'Delete' || e.key === 'Backspace') next = null;
    else return;
    e.preventDefault();
    if (next !== undefined) void commit(next);
  }
</script>

{#snippet row(small: boolean)}
  {#each [0, 1, 2, 3, 4] as i (i)}
    {@const f = fill(i)}
    <svg class="star" class:small viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs><clipPath id={`${uid}-${i}`}><rect x="0" y="0" width="12" height="24" /></clipPath></defs>
      {#if f === 1}<path class="on" d={STAR} />{:else if f === 0.5}<path class="on" d={STAR} clip-path={`url(#${uid}-${i})`} />{/if}
      <path class="edge" d={STAR} />
    </svg>
  {/each}
{/snippet}

{#if editable}
  <div class="rate">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="stars"
      role="slider"
      tabindex="0"
      aria-label="Your rating"
      aria-valuemin="0.5"
      aria-valuemax="5"
      aria-valuenow={shown === null ? undefined : shown / 2}
      aria-valuetext={shown === null ? 'Not rated' : starsText(shown)}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={() => (preview = null)}
      onkeydown={key}>
      {@render row(false)}
    </div>
    <span class="rate-num" data-testid="stars-value">{shown === null ? 'Not rated' : shown / 2}</span>
    {#if shown !== null}
      <button type="button" class="link" onclick={() => void commit(null)}>Clear</button>
    {/if}
  </div>
{:else}
  <span class="rate read">
    <span class="stars" role="img" aria-label={label}>{@render row(true)}</span>
    <span class="rate-num" aria-hidden="true">{value === null ? 'Not rated' : value / 2}</span>
  </span>
{/if}
