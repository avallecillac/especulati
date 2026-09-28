<script lang="ts">
  import { onMount } from 'svelte';
  import { parseIsbn } from '@readerlog/core';
  import type { BookCard } from '@readerlog/db';
  import { startIsbnFlow } from '../lib/isbnFlow.ts';
  import DuplicatePrompt from './DuplicatePrompt.svelte';

  let value = $state('');
  let invalid = $state(false);
  let duplicate = $state<{ isbn: string; existing: BookCard } | null>(null);
  let destroyed = false;

  onMount(() => () => (destroyed = true));

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    const r = parseIsbn(value);
    invalid = !r.ok;
    if (!r.ok) return;
    const res = await startIsbnFlow(r.value, { source: 'isbn' });
    if (res.kind === 'duplicate' && !destroyed) duplicate = { isbn: r.value, existing: res.existing };
  }
</script>

<h1>Enter ISBN</h1>

<form onsubmit={submit} novalidate>
  <label for="isbn">ISBN</label>
  <input
    id="isbn"
    type="text"
    inputmode="text"
    autocomplete="off"
    bind:value
    oninput={() => (invalid = false)}
    aria-invalid={invalid}
    aria-describedby={invalid ? 'isbn-error' : undefined}
  />
  {#if invalid}<p id="isbn-error" class="error">That isn't a valid ISBN — check the digits.</p>{/if}
  <div class="actions">
    <button class="primary" type="submit">Look up</button>
  </div>
</form>

{#if duplicate}
  {@const dup = duplicate}
  <DuplicatePrompt
    existing={dup.existing}
    onaddcopy={() => { const isbn = dup.isbn; duplicate = null; void startIsbnFlow(isbn, { skipDuplicateCheck: true, source: 'isbn' }); }}
    oncancel={() => (duplicate = null)}
  />
{/if}
