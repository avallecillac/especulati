<script lang="ts">
  /** Tab bar icons: fine line drawings in the edition's hand. Decorative; the tab label names the link. */
  let { name }: { name: 'home' | 'library' | 'add' | 'stats' | 'settings' } = $props();
</script>

<svg viewBox="0 0 28 28" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  {#if name === 'home'}
    <!-- an open book -->
    <path d="M14 8.5c-2.6-1.8-6.2-2.4-10-2v14c3.8-.4 7.4.2 10 2 2.6-1.8 6.2-2.4 10-2v-14c-3.8-.4-7.4.2-10 2z" />
    <path d="M14 8.5v14" />
    <path d="M7 10.4c1.8 0 3.4.4 4.6 1M7 13.6c1.8 0 3.4.4 4.6 1M21 10.4c-1.8 0-3.4.4-4.6 1" stroke-width="1" />
  {:else if name === 'library'}
    <!-- books on a shelf, one leaning -->
    <path d="M4 23h20" />
    <rect x="5.5" y="7" width="4" height="16" rx="0.6" />
    <rect x="10.5" y="5" width="4" height="18" rx="0.6" />
    <path d="M16.6 8.2l3.8-1.2 4.4 15.2-3.8 1.2z" />
    <path d="M5.5 11h4M10.5 9h4M10.5 19h4" stroke-width="1" />
  {:else if name === 'add'}
    <!-- a quill over a plus -->
    <circle cx="14" cy="14" r="9.5" />
    <path d="M14 9.5v9M9.5 14h9" />
  {:else if name === 'stats'}
    <!-- a sprig of days: rising leaves -->
    <path d="M5 23c5-2 9-7 11-14 1-3 3-5 7-5" />
    <path d="M9 20.4c-.4-2.6 1-4.6 3.4-5M12.6 16.6c.2-2.6 1.8-4.2 4.2-4.2M16 11.4c.6-2.2 2.2-3.4 4.4-3" stroke-width="1.2" />
    <path d="M4 23h20" />
  {:else}
    <!-- an inkwell with a pen: settings -->
    <path d="M8 23h12l-1.4-7H9.4z" />
    <path d="M10 16c0-1.6 1.8-2.6 4-2.6s4 1 4 2.6" />
    <path d="M15.6 13.2 22 4.4M20 5.8l2.8 2" stroke-width="1.2" />
  {/if}
</svg>
