<script lang="ts">
  import { untrack } from 'svelte';
  import type { EventType } from '@especulati/lector-core';
  import type { BookCard } from '@especulati/lector-db';
  import type { ClientError } from '../lib/protocol.ts';
  import { dispatch } from '../lib/dbClient.ts';
  import { todayLocal, yesterdayLocal } from '../lib/clock.ts';
  import { errorMessage } from '../lib/errors.ts';
  import { toastSaved } from '../lib/actions.ts';

  let { card, onclose }: { card: BookCard; onclose: () => void } = $props();

  const itemId = untrack(() => card.itemId);
  let page = $state(untrack(() => (card.lastPage === null ? '' : String(card.lastPage))));
  let when = $state<'today' | 'yesterday'>('today');
  let busy = $state(false);
  let error = $state<ClientError | null>(null);
  let finishPrompt = $state(false);

  /** "Today" is evaluated at save time, so a sheet opened before midnight still dates correctly. */
  const localDate = () => (when === 'today' ? todayLocal() : yesterdayLocal());

  async function log(type: EventType, pageValue: number | null): Promise<boolean> {
    busy = true;
    const eventId = crypto.randomUUID();
    const r = await dispatch({ kind: 'LogEvent', itemId, eventId, type, page: pageValue, localDate: localDate() });
    busy = false;
    if (!r.ok) {
      error = r.error;
      return false;
    }
    error = null;
    toastSaved(type === 'finished' ? 'Marked finished' : 'Saved', itemId, eventId);
    if (r.value.offerFinish) finishPrompt = true;
    else onclose();
    return true;
  }

  function save(ev: SubmitEvent) {
    ev.preventDefault();
    performance.mark('log-save');
    void log('progress', page.trim() === '' ? null : Number(page));
  }

  function step(delta: number) {
    const n = Number(page);
    const next = Number.isFinite(n) ? n + delta : delta > 0 ? 1 : 0;
    page = String(Math.max(1, next));
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  {#if finishPrompt}
    <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="finish-title">
      <h1 id="finish-title">Mark as finished?</h1>
      <p class="muted">You logged the last page of {card.title}.</p>
      <div class="actions">
        <button class="primary" disabled={busy} onclick={() => void log('finished', null)}>Mark finished</button>
        <button onclick={onclose}>Not yet</button>
      </div>
    </div>
  {:else}
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="log-title">
    <form onsubmit={save} novalidate>
      <h1 id="log-title">Log progress</h1>
      <p class="muted">{card.title}{card.totalPages ? ` · ${card.totalPages} pages` : ''}</p>

      <label for="log-page">Page</label>
      <div class="stepper">
        <button type="button" aria-label="Decrease page" onclick={() => step(-1)}>−</button>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="log-page" type="text" inputmode="numeric" autocomplete="off" bind:value={page} autofocus aria-invalid={error !== null} />
        <button type="button" aria-label="Increase page" onclick={() => step(1)}>+</button>
      </div>
      {#if error}<p class="error">{errorMessage(error)}</p>{/if}

      <div class="row" style="margin-top: 12px" role="group" aria-label="Date">
        <button type="button" class="chip" aria-pressed={when === 'today'} onclick={() => (when = 'today')}>Today</button>
        <button type="button" class="chip" aria-pressed={when === 'yesterday'} onclick={() => (when = 'yesterday')}>Yesterday</button>
      </div>

      <div class="actions">
        <button class="primary" type="submit" disabled={busy}>Save</button>
        <button type="button" disabled={busy} onclick={() => void log('progress', null)}>Read today</button>
        <div class="row">
          <button type="button" class="link" disabled={busy} onclick={() => void log('finished', null)}>Finish</button>
          <span class="spacer"></span>
          <button type="button" class="link" onclick={onclose}>Cancel</button>
        </div>
      </div>
    </form>
    </div>
  {/if}
</div>
