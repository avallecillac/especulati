<script lang="ts">
  /** A small yellow butterfly (a nod to Mauricio Babilonia). Original drawing. Decorative. */
  let { size = 28, tilt = -12, class: cls = '' }: { size?: number; tilt?: number; class?: string } = $props();
</script>

<svg class="butterfly {cls}" viewBox="0 0 32 28" width={size * (32 / 28)} height={size} style:transform="rotate({tilt}deg)" aria-hidden="true" focusable="false">
  <g fill="var(--butterfly)" stroke="var(--ink)" stroke-width="0.6" stroke-linejoin="round" stroke-opacity="0.55">
    <path d="M16 14C11.5 3.5 3.2 1.6 2.6 7.6c-.4 4.4 5.2 7 13.4 6.4z" />
    <path d="M16 14c4.5-10.5 12.8-12.4 13.4-6.4.4 4.4-5.2 7-13.4 6.4z" />
    <path d="M16 15.2c-6 .6-9.6 5.2-7.8 8.4 1.8 2.6 6.4-1.4 7.8-8.4z" />
    <path d="M16 15.2c6 .6 9.6 5.2 7.8 8.4-1.8 2.6-6.4-1.4-7.8-8.4z" />
  </g>
  <g fill="none" stroke="var(--ink)" stroke-linecap="round" stroke-opacity="0.55">
    <path stroke-width="0.5" d="M15 13 7 6.5M15 13.4 5 10.4M17 13l8-6.5M17 13.4l10-3" />
    <path stroke-width="1.3" d="M16 9.6v11" />
    <path stroke-width="0.6" d="M15.6 10c-.8-3-2-4.6-3.6-5.4M16.4 10c.8-3 2-4.6 3.6-5.4" />
  </g>
  <g fill="var(--leaf)" opacity="0.85">
    <circle cx="8" cy="8" r="1.1" /><circle cx="24" cy="8" r="1.1" />
  </g>
</svg>

<style>
  .butterfly { display: inline-block; flex: none; }
</style>
