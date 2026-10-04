<script lang="ts">
  import { untrack } from 'svelte';
  import { passageUrl, type Highlight } from '@readerlog/core';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { longDate } from '../lib/dates.ts';
  import { reportError } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import Fleuron from '../ornaments/Fleuron.svelte';
  import HighlightSheet from './HighlightSheet.svelte';

  let { itemId, url }: { itemId: string; url: string } = $props();
  const id = untrack(() => itemId);

  let items = $state<Highlight[] | null>(null);
  let expanded = $state<Record<string, boolean>>({});
  let overflowing = $state<Record<string, boolean>>({});
  let adding = $state<'highlight' | 'note' | null>(null);
  let menu = $state<Highlight | null>(null);
  let editing = $state<Highlight | null>(null);

  async function load() {
    const r = await query({ name: 'highlights', itemId: id });
    if (r.ok) items = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  /** Reports whether the clamped quote is cut off, so "Show all" appears only when needed. */
  function measure(node: HTMLElement, hid: string) {
    const check = () => {
      if (expanded[hid]) return;
      const over = node.scrollHeight > node.clientHeight + 1;
      if (overflowing[hid] !== over) overflowing[hid] = over;
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }

  async function remove(h: Highlight) {
    const hid = h.id;
    menu = null;
    const r = await dispatch({ kind: 'RemoveHighlight', highlightId: hid });
    if (!r.ok) return reportError(r.error);
    showToast('Highlight removed', {
      action: {
        label: 'Undo',
        run: () => void dispatch({ kind: 'RestoreHighlight', highlightId: hid }).then((u) => !u.ok && reportError(u.error)),
      },
    });
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && menu && (menu = null)} />

<h2>Highlights</h2>

{#if items !== null}
  {#if items.length === 0}
    <div class="vignette empty">
      <Fleuron />
      <p class="muted">Select a passage while reading to keep it here.</p>
    </div>
  {:else}
    <div class="list">
      {#each items as h (h.id)}
        <article class="entry" aria-label={h.quote ? 'Highlight' : 'Note'}>
          {#if h.quote}
            <blockquote class:clamped={!expanded[h.id]} use:measure={h.id}>
              <a href={passageUrl(url, h.quote)} target="_blank" rel="noopener noreferrer">{h.quote}</a>
            </blockquote>
            {#if overflowing[h.id] && !expanded[h.id]}
              <button type="button" class="link" onclick={() => (expanded[h.id] = true)}>Show all</button>
            {/if}
          {/if}
          {#if h.note}<p class="note">{h.note}</p>{/if}
          <div class="foot">
            <time class="smallcaps muted" datetime={h.localDate}>{longDate(h.localDate)}</time>
            <button type="button" class="link" onclick={() => (menu = h)}>More</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
  <div class="actions row-actions">
    <button type="button" onclick={() => (adding = 'highlight')}>Add highlight</button>
    <button type="button" onclick={() => (adding = 'note')}>Add note</button>
  </div>
{/if}

{#if adding}
  <HighlightSheet mode={adding} itemId={id} onclose={() => (adding = null)} />
{/if}

{#if editing}
  <HighlightSheet mode="edit" itemId={id} highlight={editing} onclose={() => (editing = null)} />
{/if}

{#if menu}
  {@const h = menu}
  <div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (menu = null)}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Highlight actions">
      <div class="actions">
        <button type="button" onclick={() => { const target = h; menu = null; editing = target; }}>{h.note ? 'Edit note' : 'Add note'}</button>
        <button type="button" class="danger" onclick={() => void remove(h)}>Remove</button>
        <button type="button" onclick={() => (menu = null)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .empty { padding: 12px 0 8px; }
  .list { display: grid; gap: 22px; margin-bottom: 8px; }
  .entry { display: grid; gap: 8px; min-width: 0; }
  blockquote {
    margin: 0; padding-left: 14px; border-left: 2px solid var(--ornament);
    font-family: var(--font-text); font-style: italic; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere;
  }
  blockquote.clamped { display: -webkit-box; -webkit-line-clamp: 8; line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }
  blockquote a { color: var(--ink); text-decoration: none; }
  blockquote a:hover, blockquote a:focus-visible { text-decoration: underline; text-decoration-color: var(--ornament); text-underline-offset: 3px; }
  .note { margin: 0; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  button.link { align-self: start; justify-self: start; min-height: var(--tap); }
  .foot button.link { color: var(--ink-soft); font-weight: 500; }
  .row-actions { grid-template-columns: 1fr 1fr; }
</style>
