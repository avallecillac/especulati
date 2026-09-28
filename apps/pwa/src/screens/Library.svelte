<script lang="ts">
  import type { LibraryView } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { progressLabel } from '../lib/format.ts';
  import { reportError } from '../lib/errors.ts';
  import Cover from './Cover.svelte';

  let view = $state<LibraryView | null>(null);

  async function load() {
    const r = await query({ name: 'library' });
    if (r.ok) view = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  const groups = [
    ['reading', 'Reading'],
    ['queued', 'Queued'],
    ['finished', 'Finished'],
    ['abandoned', 'Abandoned'],
  ] as const;
</script>

<h1>Library</h1>

{#if view}
  {@const v = view}
  {#if groups.every(([key]) => v[key].length === 0)}
    <p class="muted">No books yet. <a href="#/add">Add one</a>.</p>
  {/if}
  {#each groups as [key, label] (key)}
    {#if v[key].length > 0}
      <section aria-label={label}>
        <h2>{label} ({v[key].length})</h2>
        <ul class="plain">
          {#each v[key] as card (card.itemId)}
            <li>
              <Cover itemId={card.itemId} hasCover={card.hasCover} title={card.title} size="sm" />
              <a href={`#/book/${card.itemId}`}>{card.title}</a>
              <span class="spacer"></span>
              <span class="muted">{progressLabel(card)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/each}
{/if}
