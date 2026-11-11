<script lang="ts">
  import { untrack } from 'svelte';
  import type { ItemTagView, TagSummary } from '@especulati/lector-db';
  import { dispatch, onChanged, query, tagOp } from '../lib/dbClient.ts';
  import { errorMessage, reportError } from '../lib/errors.ts';

  /** The tags of one article as chips, plus an input that suggests existing tags (008, contracts/ui-008.md). */
  let props: { itemId: string; label?: string } = $props();
  const itemId = untrack(() => props.itemId);
  const uid = $props.id();
  const listId = `tag-list-${uid}`;
  const SHOWN = 8;

  let tags = $state<ItemTagView[]>([]);
  let suggestions = $state<TagSummary[]>([]);
  let text = $state('');
  let open = $state(false);
  let active = $state(-1);
  let error = $state('');

  async function load() {
    const r = await query({ name: 'tagsFor', itemId });
    if (!r.ok) return reportError(r.error);
    tags = r.value;
    await loadSuggestions();
  }

  async function loadSuggestions() {
    const prefix = text;
    const r = await query({ name: 'tagSuggestions', prefix, limit: SHOWN + 20 });
    if (!r.ok || prefix !== text) return;
    const have = new Set(tags.map((t) => t.nameKey));
    suggestions = r.value.filter((s) => !have.has(s.nameKey)).slice(0, SHOWN);
    active = Math.min(active, suggestions.length - 1);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  /** Adds queue behind each other, so fast typing never drops a tag. */
  let queued: Promise<void> = Promise.resolve();

  function add(name: string) {
    if (name.trim() === '') return;
    text = '';
    active = -1;
    open = false;
    error = '';
    queued = queued.then(async () => {
      const r = await tagOp({ action: 'tagArticle', itemId, name });
      if (!r.ok) {
        error = errorMessage(r.error);
        if (text === '') text = name; // keep what was typed so it can be fixed
        return;
      }
      await load();
    });
  }

  async function remove(itemTagId: string) {
    error = '';
    const r = await dispatch({ kind: 'UntagArticle', itemTagId });
    if (!r.ok) error = errorMessage(r.error);
  }

  function show() {
    open = true;
    void loadSuggestions();
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!open) return show();
      const n = suggestions.length;
      if (n === 0) return;
      active = ev.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n;
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const pick = open ? suggestions[active] : undefined;
      add(pick ? pick.name : text);
    } else if (ev.key === 'Escape' && open) {
      ev.stopPropagation();
      open = false;
      active = -1;
    }
  }
</script>

<section class="tags" aria-label="Tags">
  {#if tags.length > 0}
    <ul class="chips" aria-label="Tags on this article">
      {#each tags as t (t.itemTagId)}
        <li>
          <span>{t.name}</span>
          <button type="button" class="x" aria-label={`Remove tag ${t.name}`} onclick={() => void remove(t.itemTagId)}>×</button>
        </li>
      {/each}
    </ul>
  {/if}
  <input
    type="text"
    role="combobox"
    aria-label={props.label ?? 'Add tag'}
    placeholder="Add tag"
    aria-autocomplete="list"
    aria-expanded={open && suggestions.length > 0}
    aria-controls={listId}
    aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
    autocomplete="off"
    autocapitalize="none"
    enterkeyhint="done"
    value={text}
    onfocus={show}
    onclick={show}
    oninput={(e) => ((text = e.currentTarget.value), (active = -1), show())}
    {onkeydown}
    onblur={() => ((open = false), (active = -1))}
  />
  {#if open && suggestions.length > 0}
    <ul id={listId} class="options" role="listbox" aria-label="Tag suggestions">
      {#each suggestions as s, i (s.nameKey)}
        <!-- mousedown is held back so the input keeps focus and the click lands on the option -->
        <li
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          aria-label={s.name}
          class:active={i === active}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => add(s.name)}
          onkeydown={() => {}}
        >
          <span>{s.name}</span>
          <span class="muted count" aria-hidden="true">{s.count}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <p role="alert" class="error">{error}</p>
</section>

<style>
  .tags { margin: 0 0 12px; }
  .chips { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0 0 10px; }
  .chips li {
    display: inline-flex; align-items: center; gap: 2px; min-height: 36px; padding: 0 4px 0 14px;
    border: 0.5px solid var(--rule); border-radius: 999px; background: var(--leaf); color: var(--ink);
    max-width: 100%; overflow-wrap: anywhere;
  }
  .x { min-height: var(--tap); min-width: var(--tap); padding: 0; border: 0; background: none; color: var(--ink-soft); font-size: 1.3rem; line-height: 1; }
  .options {
    list-style: none; margin: 4px 0 0; padding: 4px; max-height: 14rem; overflow-y: auto;
    border: 0.5px solid var(--rule); border-radius: 10px; background: var(--leaf);
  }
  .options li { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-height: var(--tap); padding: 0 12px; border-radius: 8px; cursor: pointer; overflow-wrap: anywhere; }
  .options li.active { background: var(--rule); }
  .count { font-size: 0.85rem; font-variant-numeric: tabular-nums; }
</style>
