<script lang="ts">
  import { router } from '../lib/router.svelte.ts';
  import { parent } from '../lib/nav.ts';
  import { runSync, syncState } from '../lib/sync.svelte.ts';

  let title = $state('');
  let compact = $state(false);

  const back = $derived(parent(router.route));
  const isHome = $derived(router.route.name === 'home');

  /** The previous entry is the parent: go back in history so the parent keeps its scroll position. */
  function onBack(ev: MouseEvent) {
    if (back && router.previousHash === back.href) {
      ev.preventDefault();
      history.back();
    }
  }

  // The screen's own h1 is the large title. Watch for it (screens render it after loading),
  // mirror its text into data-title, and go compact once it scrolls under the bar.
  $effect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    let h1: Element | null = null;
    let io: IntersectionObserver | null = null;

    const find = () => main.querySelector('h1:not(.sheet h1)');
    const sync = () => {
      const found = find();
      title = found?.textContent?.trim() ?? '';
      if (found === h1) return;
      io?.disconnect();
      h1 = found;
      compact = false;
      if (!found) return;
      io = new IntersectionObserver(
        ([e]) => {
          compact = !!e && !e.isIntersecting && e.boundingClientRect.bottom < (e.rootBounds?.top ?? 0) + 1;
        },
        { rootMargin: '-44px 0px 0px 0px' },
      );
      io.observe(found);
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
    };
  });
</script>

<header class="bar" data-title={title} data-compact={compact ? '' : undefined} data-home={isHome ? '' : undefined}>
  {#if back}<a class="back" href={back.href} aria-label={`Back to ${back.label}`} onclick={onBack}>‹ {back.label}</a>{/if}
  {#if isHome}<a class="brand" href="#/">Lector</a>{/if}
  {#if syncState.on}
    <button class="sync-btn" class:spinning={syncState.running} type="button" aria-label="Sync now" disabled={syncState.running} onclick={() => void runSync('manual')}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18 2v4h-4M6 22v-4h4" /></svg>
    </button>
  {/if}
</header>
