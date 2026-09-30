<script lang="ts">
  /** A horizontal vine with alternating leaves, for headpieces and endpaper edges. Original drawing. Decorative. */
  let { width = 120, class: cls = '' }: { width?: number; class?: string } = $props();
</script>

<svg class="sprig {cls}" viewBox="0 0 120 20" width={width} height={width / 6} aria-hidden="true" focusable="false">
  <path fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"
    d="M4 11c14-6 26 4 40-1s22-6 32 0 24 5 40-1" />
  <g fill="currentColor">
    <path d="M16 9.4c1-3.6 4.6-5.2 8-4-1.2 3.2-4.4 4.8-8 4z" />
    <path d="M30 11.2c1.6 3.2 5.2 4.2 8.2 2.6-1.8-2.8-5.2-3.8-8.2-2.6z" />
    <path d="M52 8.6c.6-3.8 4-5.8 7.6-5-1 3.4-4 5.4-7.6 5z" />
    <path d="M68 10.6c1.6 3.2 5.2 4.4 8.2 2.8-1.8-2.8-5.2-4-8.2-2.8z" />
    <path d="M88 11.2c.8-3.6 4.2-5.4 7.8-4.4-1.2 3.2-4.4 5-7.8 4.4z" />
    <path d="M100 10.4c1.8 3 5.4 3.8 8.2 2-2-2.6-5.4-3.4-8.2-2z" />
  </g>
  <circle cx="4" cy="11" r="1.4" fill="currentColor" /><circle cx="116" cy="10" r="1.4" fill="currentColor" />
</svg>

<style>
  .sprig { color: var(--ornament); display: block; flex: none; }
</style>
