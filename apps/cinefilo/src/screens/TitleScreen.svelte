<script lang="ts">
  import { REVIEW_MAX, VERDICTS, type Status, type Verdict } from '@especulati/cinefilo-core';
  import type { TitleDetail } from '@especulati/cinefilo-db';
  import { title as loadTitle } from '../lib/dbClient.ts';
  import { todayLocal, yesterdayLocal } from '../lib/clock.ts';
  import { KIND_LABEL, STATUS_LABEL, VERDICT_GLYPH, VERDICT_LABEL, statusesFor } from '../lib/labels.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { app, showToast, write } from '../lib/state.svelte.ts';

  let { id }: { id: string } = $props();

  let detail = $state<TitleDetail | null | undefined>(undefined);
  /** The review being typed; null while untouched, so a sync can still refresh what is shown. */
  let draft = $state<string | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    void app.rev;
    let stale = false;
    void loadTitle(id).then((r) => {
      if (!stale && r.ok) detail = r.value;
    });
    return () => (stale = true);
  });

  const mine = $derived(detail?.ratings.find((r) => r.mine) ?? null);
  const others = $derived(detail?.ratings.filter((r) => !r.mine) ?? []);
  const backTab = (s: Status) => (s === 'dropped' ? 'watched' : s);

  async function run(cmd: Parameters<typeof write>[0]): Promise<boolean> {
    error = null;
    const r = await write(cmd);
    if (r.ok) return true;
    const e = r.error;
    error =
      e.kind === 'SeasonOutOfRange' ? (e.max ? `Seasons run from 1 to ${e.max}.` : 'Seasons start at 1.')
      : e.kind === 'TooLong' ? `Reviews are at most ${e.max.toLocaleString('en-US')} characters.`
      : e.kind === 'NotASeries' ? 'Only series can be watching or dropped.'
      : 'Could not save. Try again.';
    return false;
  }

  const setStatus = (status: Status, watchedOn?: string) =>
    run({ kind: 'SetStatus', titleId: id, status, ...(watchedOn ? { watchedOn } : {}) });

  const choose = (status: Status) => setStatus(status, status === 'watched' || status === 'dropped' ? todayLocal() : undefined);

  const stepSeason = (to: number) => run({ kind: 'SetCurrentSeason', titleId: id, season: to });

  function verdict(v: Verdict) {
    const next = mine?.verdict === v ? null : v;
    void run({ kind: 'SetVerdict', titleId: id, verdict: next });
  }

  async function saveReview() {
    const text = draft;
    if (text === null) return;
    if (await run({ kind: 'SetReview', titleId: id, review: text })) draft = null;
  }

  async function remove() {
    const t = detail?.title;
    if (!t) return;
    const titleId = t.id as string;
    const name = t.title as string;
    const tab = backTab(t.status);
    if (!(await run({ kind: 'RemoveTitle', titleId }))) return;
    navigate(`/${tab}`);
    showToast(`Removed ${name}.`, () => {
      void write({ kind: 'RestoreTitle', titleId });
    });
  }
</script>

{#if detail === undefined}
  <p class="muted">Loading</p>
{:else if detail === null}
  <p><a class="back" href="#/later">Back</a></p>
  <p class="empty">This title is not on the list any more.</p>
{:else}
  {@const t = detail.title}
  <a class="back" href={`#/${backTab(t.status)}`}>Back</a>
  <header class="hero">
    <span class="poster big" aria-hidden="true">{t.title.slice(0, 1).toUpperCase()}</span>
    <div>
      <h1>{t.title}</h1>
      <p class="muted">{KIND_LABEL[t.kind]}{t.year ? ` · ${t.year}` : ''}</p>
    </div>
  </header>

  <section aria-labelledby="status-h">
    <h2 id="status-h">Status</h2>
    <div class="seg" role="group" aria-label="Status">
      {#each statusesFor(t.kind) as s (s)}
        <button type="button" aria-pressed={t.status === s} onclick={() => void choose(s)}>{STATUS_LABEL[s]}</button>
      {/each}
    </div>

    {#if t.status === 'watched' || t.status === 'dropped'}
      <div class="date-row">
        <span class="muted">{t.status === 'dropped' ? 'Dropped on' : 'Watched on'}</span>
        <time datetime={t.watchedOn ?? ''}>{t.watchedOn}</time>
        <button type="button" onclick={() => void setStatus(t.status, todayLocal())}>Today</button>
        <button type="button" onclick={() => void setStatus(t.status, yesterdayLocal())}>Yesterday</button>
        <input
          type="date"
          aria-label="Pick a date"
          value={t.watchedOn ?? ''}
          max={todayLocal()}
          onchange={(e) => {
            const v = e.currentTarget.value;
            if (v) void setStatus(t.status, v);
          }} />
      </div>
    {/if}

    {#if t.kind === 'series' && t.status === 'watching'}
      <div class="stepper" role="group" aria-label="Current season">
        <button type="button" aria-label="Previous season" disabled={!t.currentSeason || t.currentSeason <= 1} onclick={() => void stepSeason((t.currentSeason ?? 1) - 1)}>−</button>
        <output>{t.currentSeason ? `Season ${t.currentSeason}` : 'No season yet'}</output>
        <button
          type="button"
          aria-label="Next season"
          disabled={t.seasonCount !== null && (t.currentSeason ?? 0) >= t.seasonCount}
          onclick={() => void stepSeason((t.currentSeason ?? 0) + 1)}>+</button>
      </div>
    {/if}
  </section>

  <section aria-labelledby="ratings-h">
    <h2 id="ratings-h">Ratings</h2>
    <div class="columns">
      {#if mine}
        <div class="col" data-testid="rating-mine">
          <h3>{mine.name} <span class="muted small">(you)</span></h3>
          <div class="verdicts-big" role="group" aria-label="Your verdict">
            {#each VERDICTS as v (v)}
              <button type="button" class={`verdict ${v}`} aria-pressed={mine.verdict === v} onclick={() => verdict(v)}>
                <span aria-hidden="true">{VERDICT_GLYPH[v]}</span>
                {VERDICT_LABEL[v]}
              </button>
            {/each}
          </div>
          <label for="my-review">Your review</label>
          <textarea
            id="my-review"
            rows="4"
            value={draft ?? mine.review ?? ''}
            oninput={(e) => (draft = e.currentTarget.value)}></textarea>
          <p class="small muted" class:error={(draft ?? '').length > REVIEW_MAX}>{(draft ?? mine.review ?? '').length} / {REVIEW_MAX.toLocaleString('en-US')}</p>
          {#if draft !== null}
            <button type="button" class="primary" onclick={() => void saveReview()}>Save review</button>
          {/if}
        </div>
      {/if}
      {#each others as o (o.memberId)}
        <div class="col" data-testid="rating-partner">
          <h3>{o.name}</h3>
          {#if o.verdict || o.review}
            {#if o.verdict}<p class={`verdict-read ${o.verdict}`}><span aria-hidden="true">{VERDICT_GLYPH[o.verdict]}</span> {VERDICT_LABEL[o.verdict]}</p>{/if}
            {#if o.review}<p class="review">{o.review}</p>{/if}
          {:else}
            <p class="muted">Not rated yet</p>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <p role="alert" class="error">{error ?? ''}</p>

  <section>
    <button type="button" class="danger" onclick={() => void remove()}>Remove from list</button>
  </section>
{/if}
