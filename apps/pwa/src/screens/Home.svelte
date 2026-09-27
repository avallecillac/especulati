<script lang="ts">
  import type { HomeView } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { STATUS_LABEL, plural, progressLabel } from '../lib/format.ts';
  import { errorMessage } from '../lib/errors.ts';
  import { showToast } from '../lib/toast.svelte.ts';

  let view = $state<HomeView | null>(null);

  async function load() {
    const r = await query({ name: 'home' });
    if (r.ok) view = r.value;
    else showToast(errorMessage(r.error), { kind: 'error' });
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });
</script>

{#if view}
  {#if view.current}
    {@const c = view.current}
    <section class="card" aria-label="Current book">
      <p class="muted">{STATUS_LABEL[c.status]}</p>
      <h1><a href={`#/book/${c.itemId}`}>{c.title}</a></h1>
      {#if c.author}<p class="muted">{c.author}</p>{/if}
      <p>{progressLabel(c)}</p>
    </section>
  {:else}
    <section class="card">
      <h1>No book in progress</h1>
      <p class="muted">Add a book and start reading to log your progress here.</p>
      <a class="button primary" href="#/add">Add a book</a>
    </section>
  {/if}
  {#if view.queuedCount > 0}
    <p class="muted"><a href="#/library">{plural(view.queuedCount, 'book')} queued</a></p>
  {/if}
{/if}
