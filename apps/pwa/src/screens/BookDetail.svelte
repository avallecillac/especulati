<script lang="ts">
  import { untrack } from 'svelte';
  import type { EventType } from '@readerlog/core';
  import type { BookEventView, BookView } from '@readerlog/db';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { reportError } from '../lib/errors.ts';
  import { STATUS_LABEL, plural, progressLabel } from '../lib/format.ts';
  import { shortDate } from '../lib/dates.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast } from '../lib/toast.svelte.ts';
  import { toastSaved, undoEvent } from '../lib/actions.ts';
  import Cover from './Cover.svelte';
  import DetailsBadge from './DetailsBadge.svelte';
  import LogSheet from './LogSheet.svelte';
  import Confirm from './Confirm.svelte';

  let props: { id: string } = $props();
  // The route is keyed on the id ({#key} in App.svelte).
  const id = untrack(() => props.id);

  let view = $state<BookView | null | undefined>(undefined);
  let logging = $state(false);
  let confirming = $state<'abandon' | 'remove' | null>(null);
  let removingEvent = $state<BookEventView | null>(null);

  async function load() {
    const r = await query({ name: 'book', itemId: id, today: todayLocal() });
    if (r.ok) view = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  async function record(type: EventType) {
    const eventId = crypto.randomUUID();
    const r = await dispatch({ kind: 'LogEvent', itemId: id, eventId, type, localDate: todayLocal() });
    if (r.ok) toastSaved(type === 'started' ? 'Started' : type === 'finished' ? 'Marked finished' : 'Abandoned', id, eventId);
    else reportError(r.error);
  }

  async function removeBook() {
    confirming = null;
    const r = await dispatch({ kind: 'RemoveBook', itemId: id });
    if (!r.ok) return reportError(r.error);
    showToast('Book removed');
    navigate('/library');
  }

  const describe = (e: BookEventView) =>
    e.type === 'started' ? 'Started'
    : e.type === 'finished' ? 'Finished'
    : e.type === 'abandoned' ? 'Abandoned'
    : e.page === null ? 'Read (no page)'
    : `Page ${e.page}`;

  const dateLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
</script>

{#if view === null}
  <h1>Book not found</h1>
  <p class="muted">It may have been removed. <a href="#/library">Back to library</a></p>
{:else if view}
  {@const c = view.card}
  <div class="with-cover">
    <Cover itemId={c.itemId} hasCover={c.hasCover} title={c.title} size="md" />
    <div>
      <p class="muted">{STATUS_LABEL[c.status]}</p>
      <h1>{c.title}</h1>
      <DetailsBadge status={c.detailsStatus} />
      {#if c.author}<p class="muted">{c.author}</p>{/if}
      {#if c.isbn}<p class="muted">ISBN {c.isbn}</p>{/if}
      <p>{progressLabel(c)}{c.genre ? ` · ${c.genre}` : ''}</p>
      {#if view.pace}
        {@const p = view.pace}
        <p class="muted" data-testid="pace">
          {#if p.pagesPerDay === 0}No recent pace{:else}{p.pagesPerDay} pages/day{#if p.daysLeft !== null && p.finishDate} · about {plural(p.daysLeft, 'day')} left (around {shortDate(p.finishDate)}){/if}{/if}
        </p>
      {/if}
    </div>
  </div>

  <div class="row">
    {#if c.status !== 'reading'}<button onclick={() => void record('started')}>Start</button>{/if}
    <button class="primary" onclick={() => (logging = true)}>Log</button>
    {#if c.status === 'reading'}
      <button onclick={() => void record('finished')}>Finish</button>
      <button onclick={() => (confirming = 'abandon')}>Abandon</button>
    {/if}
    <button onclick={() => navigate(`/edit/${id}`)}>Edit</button>
  </div>

  <h2 id="history-title">History</h2>
  {#if view.events.length === 0}
    <p class="muted">Nothing logged yet.</p>
  {:else}
    <ul class="plain" aria-labelledby="history-title">
      {#each view.events as e (e.id)}
        <li>
          <span>{describe(e)}</span>
          <span class="spacer"></span>
          <time class="muted" datetime={e.localDate}>{dateLabel(e.localDate)}</time>
          <button class="link danger" aria-label="Remove" onclick={() => (removingEvent = e)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <button class="danger" onclick={() => (confirming = 'remove')}>Remove book</button>
  </div>

  {#if logging}
    <LogSheet card={c} onclose={() => (logging = false)} />
  {/if}
  {#if removingEvent}
    {@const target = removingEvent}
    <Confirm title="Remove this entry?" body={`${describe(target)} on ${dateLabel(target.localDate)}.`} confirmLabel="Remove" danger
      onconfirm={() => { const eventId = target.id; removingEvent = null; void undoEvent(id, eventId); }} oncancel={() => (removingEvent = null)} />
  {/if}
  {#if confirming === 'abandon'}
    <Confirm title="Abandon this book?" body="You can start it again later." confirmLabel="Abandon"
      onconfirm={() => { confirming = null; void record('abandoned'); }} oncancel={() => (confirming = null)} />
  {:else if confirming === 'remove'}
    <Confirm title="Remove this book?" body="It and its history disappear from every view." confirmLabel="Remove" danger
      onconfirm={() => void removeBook()} oncancel={() => (confirming = null)} />
  {/if}
{/if}
