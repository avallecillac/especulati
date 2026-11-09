<script lang="ts">
  import type { SearchHit, TagSummary } from '@readerlog/db';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { reportError } from '../lib/errors.ts';
  import { markMatches } from '../lib/markMatches.ts';
  import Butterfly from '../ornaments/Butterfly.svelte';
  import TagsSheet from './TagsSheet.svelte';

  /** Search over articles, read and saved, plus an AND tag filter (008 US4, contracts/ui-008.md). `active`: results replace the lists. */
  let { active = $bindable(false) }: { active?: boolean } = $props();

  const DEBOUNCE_MS = 80;
  const CHIPS = 8;

  let text = $state('');
  let selected = $state<string[]>([]); // tag name keys
  let tags = $state<TagSummary[]>([]);
  /** The last results that arrived; they stay on screen while the next ones load. */
  let results = $state<SearchHit[] | null>(null);
  /** The query the shown results answer, for marking passages. */
  let shownText = $state('');
  let tagsOpen = $state(false);

  const isActive = $derived(text.trim() !== '' || selected.length > 0);
  $effect(() => {
    active = isActive;
  });

  async function loadTags() {
    const r = await query({ name: 'allTags' });
    if (r.ok) tags = r.value;
    else reportError(r.error);
  }

  // Most used first; a chip that is selected stays visible even when it is not among the most used.
  const chips = $derived.by(() => {
    const byUse = [...tags].sort((a, b) => b.count - a.count || (a.nameKey < b.nameKey ? -1 : 1));
    const top = byUse.slice(0, CHIPS);
    const extra = byUse.slice(CHIPS).filter((t) => selected.includes(t.nameKey));
    return [...top, ...extra];
  });

  let seq = 0;
  async function run(q: string, keys: string[]) {
    const mine = ++seq;
    const r = await query({ name: 'search', query: q, tagKeys: keys });
    if (mine !== seq) return; // a newer search is on its way
    if (r.ok) {
      results = r.value;
      shownText = q;
    } else reportError(r.error);
  }

  $effect(() => {
    const q = text;
    const keys = [...selected];
    if (q.trim() === '' && keys.length === 0) {
      seq++;
      results = null;
      return;
    }
    const timer = setTimeout(() => void run(q, keys), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void loadTags();
    return onChanged(() => {
      void loadTags();
      if (isActive) void run(text, [...selected]);
    });
  });

  function toggle(key: string) {
    selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  }

  function clear() {
    text = '';
    selected = [];
  }
</script>

<div class="search">
  <input type="search" aria-label="Search articles" placeholder="Search articles" autocomplete="off" autocapitalize="none" spellcheck="false" bind:value={text} />
  <div class="chips">
    {#each chips as t (t.nameKey)}
      <button type="button" class="chip" aria-pressed={selected.includes(t.nameKey)} onclick={() => toggle(t.nameKey)}>{t.name}</button>
    {/each}
    <button type="button" class="link" aria-haspopup="dialog" onclick={() => (tagsOpen = true)}>All tags…</button>
    {#if isActive && results && results.length > 0}
      <button type="button" class="link" onclick={clear}>Clear</button>
    {/if}
  </div>
</div>

{#if isActive && results}
  {#if results.length === 0}
    <div class="vignette">
      <Butterfly size={40} />
      <p class="title">No results</p>
      <p class="muted">Nothing matches. Try other words or fewer tags.</p>
      <button type="button" onclick={clear}>Clear</button>
    </div>
  {:else}
    <ul class="plain" aria-label="Search results">
      {#each results as h (h.itemId)}
        <li data-testid="search-row">
          <div class="article-main">
            <a class="article-title" href={`#/article/${h.itemId}`}>{h.title}</a>
            <span class="muted smallcaps">{h.domain}</span>
            {#if h.passage}
              <span class="passage" class:note={h.passage.kind === 'note'}>
                {#each markMatches(h.passage.text, shownText) as p}{#if p.mark}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
              </span>
            {/if}
          </div>
          <span class="spacer"></span>
          <span class="muted label">{h.status === 'saved' ? 'Saved' : 'Read'}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

{#if tagsOpen}
  <TagsSheet onclose={() => (tagsOpen = false)} />
{/if}

<style>
  .search { margin-bottom: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .passage { margin-top: 4px; font-size: 0.92rem; overflow-wrap: anywhere; }
  .passage.note { font-style: italic; }
  mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
  .label { flex: none; font-style: italic; font-size: 0.9rem; }
  .vignette button { margin-top: 8px; }
</style>
