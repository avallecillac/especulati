<script lang="ts">
  /** A hedera-style fleuron: an ivy leaf on a curled stem. Original drawing. Decorative. */
  let { size = 22, class: cls = '' }: { size?: number; class?: string } = $props();
</script>

<svg class="ornament {cls}" viewBox="0 0 40 24" width={size * (40 / 24)} height={size} aria-hidden="true" focusable="false">
  <path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"
    d="M3 15c3-6 9-8 12-4 2 3-1 6-3 4.5M15 11c1-1 2.2-1.4 3.4-1.2" />
  <path fill="currentColor"
    d="M18.2 10.4c1.6-5.6 8.6-8.4 14.6-5.6 1.6.8 3 2 4 3.4-2.6-.2-4.4 1-5 3 3 .6 4.4 2.6 4 5.2-5.4 2.6-11.6 1.6-15-2.6-.9-1.1-2-2.3-2.6-3.4z" />
  <path fill="none" stroke="var(--leaf)" stroke-width="0.7" stroke-linecap="round" opacity="0.8"
    d="M19.5 11.2c4-.6 8.6-.4 13.4 1.4M24 10.8c1.6-2 3.6-3.4 6-4.2M25 11.2c1.8 1.6 3.6 2.8 6 3.6" />
</svg>

<style>
  .ornament { color: var(--ornament); display: inline-block; vertical-align: middle; flex: none; }
</style>
