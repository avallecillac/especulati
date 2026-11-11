<script lang="ts">
  /**
   * An illustrated capital: the letter in the display face inside a small vine frame,
   * like the edition's chapter openings. The letter is visual only; the full text is
   * rendered next to it for assistive tech and tests.
   */
  let { letter, size = 64 }: { letter: string; size?: number } = $props();
</script>

<span class="dropcap" style:--s="{size}px" aria-hidden="true">
  <svg viewBox="0 0 64 64" width={size} height={size} focusable="false">
    <rect x="3" y="3" width="58" height="58" fill="none" stroke="currentColor" stroke-width="0.8" />
    <rect x="6" y="6" width="52" height="52" fill="none" stroke="currentColor" stroke-width="0.4" />
    <g fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round">
      <path d="M6 20c6-2 10-7 11-14M20 6c-1 5 1 9 5 11" />
      <path d="M58 44c-6 2-10 7-11 14M44 58c1-5-1-9-5-11" />
    </g>
    <g fill="currentColor">
      <path d="M11 13c2.6-2.6 6-2.6 7.4-1-2 2.2-5 2.6-7.4 1z" />
      <path d="M53 51c-2.6 2.6-6 2.6-7.4 1 2-2.2 5-2.6 7.4-1z" />
      <circle cx="6" cy="6" r="1.6" /><circle cx="58" cy="58" r="1.6" />
    </g>
  </svg>
  <span class="letter">{letter}</span>
</span>

<style>
  .dropcap { position: relative; display: inline-grid; place-items: center; width: var(--s); height: var(--s); color: var(--ornament); flex: none; }
  .dropcap svg { position: absolute; inset: 0; }
  .letter { position: relative; font-family: var(--font-display); font-weight: 600; font-size: calc(var(--s) * 0.62); line-height: 1; color: var(--accent); transform: translateY(4%); }
</style>
