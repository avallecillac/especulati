<script lang="ts">
  import { readingMinutes, type Article } from '@readerlog/core';
  import { onChanged, query } from '../lib/dbClient.ts';
  import { reportError } from '../lib/errors.ts';

  let articles = $state<Article[] | null>(null);

  async function load() {
    const r = await query({ name: 'articles' });
    if (r.ok) articles = r.value;
    else reportError(r.error);
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });

  function minutesLabel(a: Article): string {
    const m = readingMinutes(a.wordCount);
    return m === null ? '—' : `~${m} min`;
  }
</script>

{#if articles}
  {#if articles.length === 0}
    <p class="muted">No articles yet.</p>
  {:else}
    <ul class="plain" aria-label="Articles">
      {#each articles as a (a.id)}
        <li data-testid="article-row">
          <div class="article-main">
            <span class="article-title">{a.title}</span>
            <span class="muted">{a.domain} · {a.readOn}</span>
          </div>
          <span class="spacer"></span>
          <span class="muted">{minutesLabel(a)}</span>
        </li>
      {/each}
    </ul>
  {/if}
{/if}
