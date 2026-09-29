<script lang="ts">
  import type { DuplicateBookView, DuplicatePairView } from '@readerlog/db';
  import { dispatch, onChanged, query } from '../lib/dbClient.ts';
  import { longDate } from '../lib/dates.ts';
  import { reportError } from '../lib/errors.ts';
  import { plural } from '../lib/format.ts';
  import { dismissalId, mergeCopyId } from '../lib/ids.ts';

  let pairs = $state<DuplicatePairView[] | null>(null);
  let busy = $state(false);

  async function load() {
    const r = await query({ name: 'duplicates' });
    if (r.ok) pairs = r.value;
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  /** "Added Mar 5, 2026", in the reader's own time zone. */
  function added(iso: string): string {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `Added ${longDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)}`;
  }

  async function merge(pair: DuplicatePairView) {
    const survivorId = pair.survivor.itemId;
    const duplicateId = pair.duplicate.itemId;
    busy = true;
    try {
      const book = await query({ name: 'book', itemId: duplicateId });
      if (!book.ok || !book.value) return void (await load());
      const copies = await Promise.all(
        book.value.events.map(async (e) => ({ from: e.id, to: await mergeCopyId(survivorId, e) })),
      );
      const r = await dispatch({ kind: 'MergeBooks', survivorId, duplicateId, copies });
      if (!r.ok) reportError(r.error);
    } finally {
      busy = false;
    }
  }

  async function keepBoth(pair: DuplicatePairView) {
    const a = pair.survivor.itemId;
    const b = pair.duplicate.itemId;
    busy = true;
    try {
      const r = await dispatch({ kind: 'DismissDuplicate', dismissalId: await dismissalId(a, b), itemA: a, itemB: b });
      if (!r.ok) reportError(r.error);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet side(b: DuplicateBookView, kept: boolean)}
  <div class="side">
    <p><strong>{b.title}</strong>{#if kept} <span class="chip-kept">Kept</span>{/if}</p>
    <p class="muted">{b.author ?? 'No author'}</p>
    <p class="muted">ISBN: {b.isbn ?? '—'}</p>
    <p class="muted">{plural(b.entryCount, 'entry', 'entries')}</p>
    <p class="muted">{added(b.createdAt)}</p>
  </div>
{/snippet}

<h1>Duplicate books</h1>
<p><a href="#/settings/sync">Back to Sync</a></p>

{#if pairs === null}
  <p class="muted">Loading…</p>
{:else if pairs.length === 0}
  <section class="card"><p>No duplicate books found.</p></section>
{:else}
  <p class="muted">Merging keeps the copy added first and moves every entry onto it.</p>
  {#each pairs as pair (pair.survivor.itemId + pair.duplicate.itemId)}
    <section class="card" aria-label={`Duplicate: ${pair.survivor.title}`}>
      <div class="pair">
        {@render side(pair.survivor, true)}
        {@render side(pair.duplicate, false)}
      </div>
      <div class="actions">
        <button class="primary" type="button" disabled={busy} onclick={() => void merge(pair)}>Merge</button>
        <button type="button" disabled={busy} onclick={() => void keepBoth(pair)}>Keep both</button>
      </div>
    </section>
  {/each}
{/if}

<style>
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .side p { margin: 2px 0; overflow-wrap: anywhere; }
  .chip-kept { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
</style>
