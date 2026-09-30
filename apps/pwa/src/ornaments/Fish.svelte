<script lang="ts">
  /** A little golden fish, after the Colonel's workshop. Original drawing. Decorative. */
  let { size = 22, class: cls = '' }: { size?: number; class?: string } = $props();
</script>

<svg class="fish {cls}" viewBox="0 0 40 24" width={size * (40 / 24)} height={size} aria-hidden="true" focusable="false">
  <path fill="var(--butterfly)" stroke="currentColor" stroke-width="1" stroke-linejoin="round"
    d="M4 12c5-7 16-8.4 23-2l7-5.4c-.8 2.4-1 4.8-.4 7.4-.6 2.6-.4 5 .4 7.4L27 14c-7 6.4-18 5-23-2z" />
  <g fill="none" stroke="currentColor" stroke-width="0.6" stroke-linecap="round" opacity="0.8">
    <path d="M12 8.4c1.6 2.2 1.6 5 0 7.2M16 8c1.6 2.4 1.6 5.6 0 8M20 8.4c1.4 2.2 1.4 5 0 7.2" />
    <path d="M28 7.6c1 1.8 1.4 3 1.4 4.4" />
  </g>
  <circle cx="8.4" cy="11" r="1" fill="currentColor" />
</svg>

<style>
  .fish { color: var(--ornament); display: inline-block; flex: none; }
</style>
