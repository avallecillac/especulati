<script lang="ts">
  import type { BookCard, HomeView } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { STATUS_LABEL, plural, progressLabel } from '../lib/format.ts';
  import { reportError } from '../lib/errors.ts';
  import DropCap from '../ornaments/DropCap.svelte';
  import Sprig from '../ornaments/Sprig.svelte';
  import Butterfly from '../ornaments/Butterfly.svelte';
  import Cover from './Cover.svelte';
  import DetailsBadge from './DetailsBadge.svelte';
  import LogSheet from './LogSheet.svelte';

  let view = $state<HomeView | null>(null);
  let logging = $state<BookCard | null>(null);
  /** Which reading book the card targets; defaults to the most recent (FR-008). */
  let selectedId = $state<string | null>(null);

  const current = $derived(
    view === null ? null
    : [view.current, ...view.otherReading].find((c) => c?.itemId === selectedId) ?? view.current,
  );
  const others = $derived(view ? [view.current, ...view.otherReading].filter((c): c is BookCard => c !== null && c !== current) : []);

  async function load() {
    const r = await query({ name: 'home' });
    if (r.ok) view = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  // Runs after the DOM reflects a new view: lets tests measure save → visible (SC-002).
  $effect(() => {
    if (view) performance.mark('home-rendered');
  });

  const dateLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

{#if view}
  {#if current}
    <div class="headpiece"><DropCap letter={[...current.title.trim()][0]?.toUpperCase() ?? '#'} size={56} /></div>
    <section class="card" aria-label="Current book">
      <div class="with-cover">
        <Cover itemId={current.itemId} hasCover={current.hasCover} title={current.title} size="md" />
        <div>
          <p class="running-head status">{STATUS_LABEL[current.status]}</p>
          <h1><a href={`#/book/${current.itemId}`}>{current.title}</a></h1>
          <DetailsBadge status={current.detailsStatus} />
          {#if current.author}<p class="muted smallcaps">{current.author}</p>{/if}
          <p class="progress">{progressLabel(current)}</p>
          {#if current.lastActivity}
            <p class="muted">Last read <time datetime={current.lastActivity.localDate}>{dateLabel(current.lastActivity.localDate)}</time></p>
          {/if}
          <div class="actions"><button class="primary" onclick={() => (logging = current)}>Log</button></div>
        </div>
      </div>
    </section>
    <Sprig class="tail" />
  {:else}
    <section class="card vignette">
      <Butterfly size={48} />
      <h1>No book in progress</h1>
      <p class="muted">Add a book and start reading to log your progress here.</p>
      <a class="button primary" href="#/add">Add a book</a>
    </section>
  {/if}

  {#if others.length > 0}
    <h2>Also reading</h2>
    <div class="row">
      {#each others as other (other.itemId)}
        <button class="chip" onclick={() => (selectedId = other.itemId)}>{other.title}</button>
      {/each}
    </div>
  {/if}

  {#if view.queuedCount > 0}
    <p class="muted"><a href="#/library">{plural(view.queuedCount, 'book')} queued</a></p>
  {/if}
{/if}

{#if logging}
  <LogSheet card={logging} onclose={() => (logging = null)} />
{/if}

<style>
  .headpiece { display: flex; justify-content: center; margin: 4px 0 10px; color: var(--ornament); }
  .status { margin: 0; }
  .progress { font-style: italic; margin: 4px 0 0; }
  :global(.tail) { margin: 18px auto 0; }
</style>
