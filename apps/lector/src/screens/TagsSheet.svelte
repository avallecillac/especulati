<script lang="ts">
  import { tagKey } from '@especulati/lector-core';
  import type { TagSummary } from '@especulati/lector-db';
  import { onChanged, query, tagOp } from '../lib/dbClient.ts';
  import { errorMessage, reportError } from '../lib/errors.ts';
  import Confirm from './Confirm.svelte';

  /** Every tag with its article count; Rename (merging into an existing name) and Delete (008, contracts/ui-008.md). */
  let { onclose }: { onclose: () => void } = $props();

  let tags = $state<TagSummary[] | null>(null);
  let renaming = $state<TagSummary | null>(null);
  let newName = $state('');
  let deleting = $state<TagSummary | null>(null);
  let error = $state('');

  async function load() {
    const r = await query({ name: 'allTags' });
    if (r.ok) tags = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  /** The other tag this name would merge into, if any. */
  const mergeTarget = $derived.by((): TagSummary | null => {
    const key = tagKey(newName);
    if (key === null || !renaming) return null;
    return tags?.find((t) => t.nameKey === key && t.nameKey !== renaming!.nameKey) ?? null;
  });

  const count = (t: TagSummary): string => `${t.count} ${t.count === 1 ? 'article' : 'articles'}`;

  function startRename(t: TagSummary) {
    renaming = t;
    newName = t.name;
    error = '';
  }

  async function rename(ev: SubmitEvent) {
    ev.preventDefault();
    const t = renaming;
    if (!t) return;
    const ids = [...t.tagIds]; // a plain array: a $state proxy cannot cross postMessage
    const name = newName;
    const r = await tagOp({ action: 'renameTag', tagIds: ids, newName: name });
    if (!r.ok) return void (error = errorMessage(r.error));
    renaming = null;
  }

  async function remove(ids: string[]) {
    const r = await tagOp({ action: 'deleteTag', tagIds: ids });
    if (!r.ok) error = errorMessage(r.error);
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && !deleting) onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="tags-title">
    <h1 id="tags-title">All tags</h1>
    {#if tags && tags.length === 0}
      <p class="muted">No tags yet. Add one from an article.</p>
    {:else if tags}
      <ul class="plain">
        {#each tags as t (t.nameKey)}
          <li>
            {#if renaming?.nameKey === t.nameKey}
              <form class="rename" onsubmit={(e) => void rename(e)} novalidate>
                <label for="tag-new-name">New name</label>
                <!-- svelte-ignore a11y_autofocus -->
                <input id="tag-new-name" type="text" bind:value={newName} autofocus />
                {#if mergeTarget}<p class="muted">Merges into {mergeTarget.name}</p>{/if}
                <div class="row">
                  <button class="primary" type="submit" disabled={tagKey(newName) === null}>Save</button>
                  <button type="button" onclick={() => (renaming = null)}>Cancel</button>
                </div>
              </form>
            {:else}
              <div class="name">
                <span>{t.name}</span>
                <span class="muted smallcaps">{count(t)}</span>
              </div>
              <span class="spacer"></span>
              <button type="button" class="link" aria-label={`Rename ${t.name}`} onclick={() => startRename(t)}>Rename</button>
              <button type="button" class="link danger" aria-label={`Delete ${t.name}`} onclick={() => ((deleting = t), (error = ''))}>Delete</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <p role="alert" class="error">{error}</p>
    <div class="actions">
      <button type="button" class="primary" onclick={onclose}>Close</button>
    </div>
  </div>
</div>

{#if deleting}
  {@const d = deleting}
  <Confirm
    title="Delete this tag?"
    body={`“${d.name}” is removed from every article. The articles stay.`}
    confirmLabel="Delete"
    danger
    onconfirm={() => {
      const ids = [...d.tagIds];
      deleting = null;
      void remove(ids);
    }}
    oncancel={() => (deleting = null)}
  />
{/if}

<style>
  .name { display: grid; min-width: 0; overflow-wrap: anywhere; }
  .rename { display: grid; width: 100%; gap: 6px; }
  .rename label { margin: 0; }
  .rename p { margin: 0; }
  li:has(.rename) { padding-top: 8px; padding-bottom: 12px; }
</style>
