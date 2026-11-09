<script lang="ts">
  import { untrack } from 'svelte';
  import type { Highlight } from '@readerlog/core';
  import type { ClientError } from '../lib/protocol.ts';
  import { dispatch, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { errorMessage } from '../lib/errors.ts';

  /** Add highlight (quote + note), Add note (note only), or Edit note (an existing highlight). */
  let { mode, itemId, highlight, onclose }: {
    mode: 'highlight' | 'note' | 'edit';
    itemId: string;
    highlight?: Highlight;
    onclose: () => void;
  } = $props();

  // The parent mounts a fresh sheet per use, so these never change.
  const kind = untrack(() => mode);
  const editing = untrack(() => (mode === 'edit' ? highlight : undefined));
  const withQuote = kind === 'highlight';
  const COUNTER_FROM = 4500;
  const MAX = 5000;

  let quote = $state('');
  let note = $state(editing?.note ?? '');
  let busy = $state(false);
  let error = $state<ClientError | null>(null);

  const title = kind === 'highlight' ? 'Add highlight' : kind === 'note' ? 'Add note' : editing?.note ? 'Edit note' : 'Add note';
  // Clearing a note is fine while a quote remains; the core rejects the rest.
  const empty = $derived(quote.trim() === '' && note.trim() === '' && !(editing && editing.quote !== null));
  const count = (s: string) => [...s].length;

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    if (empty || busy) return;
    busy = true;
    // A highlight on a saved article means it was read (FR-006): mark it read first.
    if (!editing) {
      const saved = await query({ name: 'savedArticle', itemId });
      if (saved.ok && saved.value) {
        const read = await dispatch({ kind: 'MarkArticleRead', itemId, readOn: todayLocal() });
        if (!read.ok && read.error.kind !== 'AlreadyRead') {
          busy = false;
          return void (error = read.error);
        }
      }
    }
    const r = editing
      ? await dispatch({ kind: 'EditHighlightNote', highlightId: editing.id, note })
      : await dispatch({
          kind: 'AddHighlight',
          highlightId: crypto.randomUUID(),
          itemId,
          quote: withQuote ? quote : null,
          note,
          localDate: todayLocal(),
        });
    busy = false;
    if (!r.ok) return void (error = r.error);
    onclose();
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="hl-title">
    <form onsubmit={(e) => void save(e)} novalidate>
      <h1 id="hl-title">{title}</h1>
      {#if editing?.quote}<p class="muted quoted">{editing.quote}</p>{/if}
      {#if withQuote}
        <label for="hl-quote">Quote</label>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea id="hl-quote" rows="5" bind:value={quote} autofocus aria-invalid={error?.kind === 'TooLong'}></textarea>
        {#if count(quote) > COUNTER_FROM}<p class="counter muted" class:over={count(quote) > MAX}>{count(quote)} / {MAX}</p>{/if}
      {/if}
      <label for="hl-note">Note</label>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea id="hl-note" rows={withQuote ? 3 : 5} bind:value={note} autofocus={!withQuote}></textarea>
      {#if count(note) > COUNTER_FROM}<p class="counter muted" class:over={count(note) > MAX}>{count(note)} / {MAX}</p>{/if}
      <p role="alert" class="error">{error ? errorMessage(error) : ''}</p>

      <div class="actions">
        <button class="primary" type="submit" disabled={empty || busy}>Save</button>
        <button type="button" onclick={onclose}>Cancel</button>
      </div>
    </form>
  </div>
</div>

<style>
  textarea {
    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; resize: vertical;
    border: 0.5px solid var(--rule); background: var(--leaf); color: var(--ink); font-family: var(--font-text); line-height: 1.45;
  }
  .counter { text-align: right; font-size: 0.85rem; margin: 4px 0 0; font-variant-numeric: tabular-nums; }
  .counter.over { color: var(--danger); }
  .quoted {
    margin: 0 0 4px; font-style: italic; border-left: 2px solid var(--ornament); padding-left: 12px;
    overflow-wrap: anywhere; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
</style>
