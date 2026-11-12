<script lang="ts">
  import { onMount } from 'svelte';
  import { REVIEW_MAX, type MemberStatus, type Status } from '@especulati/cinefilo-core';
  import type { TitleDetail } from '@especulati/cinefilo-db';
  import { findByTmdb, title as loadTitle } from '../lib/dbClient.ts';
  import { failureText, type TmdbResult } from '../catalog/tmdb.ts';
  import { details, search, tmdb } from '../lib/tmdb.svelte.ts';
  import { todayLocal, yesterdayLocal } from '../lib/clock.ts';
  import { KIND_LABEL, STATUS_LABEL, memberStatusesFor, statusesFor } from '../lib/labels.ts';
  import { listView } from '../lib/listView.svelte.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { app, showToast, write } from '../lib/state.svelte.ts';
  import Poster from './Poster.svelte';

  let { id }: { id: string } = $props();

  // A title always opens at its top, whatever the list behind it was scrolled to (cinefilo-compact-lists D5).
  onMount(() => window.scrollTo(0, 0));

  let detail = $state<TitleDetail | null | undefined>(undefined);
  /** The review being typed; null while untouched, so a sync can still refresh what is shown. */
  let draft = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** Undated watched title: true while the date controls are open ('Add date'). */
  let addingDate = $state(false);
  let linking = $state<{ q: string; results: TmdbResult[] | null; note: string | null; busy: boolean } | null>(null);

  $effect(() => {
    void app.rev;
    let stale = false;
    void loadTitle(id).then((r) => {
      if (!stale && r.ok) detail = r.value;
    });
    return () => (stale = true);
  });

  const myP = $derived(detail?.personal.find((p) => p.mine) ?? null);
  const partnerP = $derived(detail?.personal.find((p) => !p.mine) ?? null);
  /** The title was opened from the partner's list: nothing but "You" is editable here. */
  const viewOnly = $derived(listView.scope === 'partner');
  const myRec = $derived(detail?.recommendations.find((r) => r.fromMe) ?? null);
  const mine = $derived(detail?.ratings.find((r) => r.mine) ?? null);
  const others = $derived(detail?.ratings.filter((r) => !r.mine) ?? []);
  // A title only on someone's personal list has no Together status (null): it goes back to Watch later.
  const backTab = (s: Status | null) => (s === 'dropped' ? 'watched' : (s ?? 'later'));

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

  const setStatus = (status: Status | null, watchedOn?: string) =>
    status === null ? Promise.resolve(false) : run({ kind: 'SetStatus', titleId: id, status, ...(watchedOn ? { watchedOn } : {}) });

  const choose = (status: Status) => setStatus(status, status === 'watched' || status === 'dropped' ? todayLocal() : undefined);

  const setMine = (status: MemberStatus | null, watchedOn?: string) =>
    run({ kind: 'SetMyStatus', titleId: id, status, ...(watchedOn ? { watchedOn } : {}) });
  const chooseMine = (status: MemberStatus | null) => setMine(status, status === 'watched' ? todayLocal() : undefined);
  const stepMine = (to: number) => run({ kind: 'SetMySeason', titleId: id, season: to });

  const stepSeason = (to: number) => run({ kind: 'SetCurrentSeason', titleId: id, season: to });

  // Placeholder until the star control (cinefilo-stars 2.1): five whole-star buttons that write half stars.
  function setStars(n: number | null) {
    void run({ kind: 'SetStars', titleId: id, stars: n });
  }

  async function saveReview() {
    const text = draft;
    if (text === null) return;
    if (await run({ kind: 'SetReview', titleId: id, review: text })) draft = null;
  }

  async function runLinkSearch() {
    const l = linking;
    const t = detail?.title;
    if (!l || !t || l.busy || l.q.trim() === '') return;
    const q = l.q;
    const kind = t.kind;
    linking = { q, results: null, note: null, busy: true };
    const r = await search(q, kind);
    if (r.kind === 'ok') linking = { q, results: r.value, note: r.value.length === 0 ? 'No matches. Try another spelling.' : null, busy: false };
    else linking = { q, results: null, note: r.kind === 'no-key' ? 'Add a TMDB key in Settings first.' : failureText(r), busy: false };
  }

  /** Fill the empty details from TMDB onto this same entry: status, watched date and both ratings stay (D4). */
  async function link(hit: TmdbResult) {
    const t = detail?.title;
    if (!t || linking?.busy) return;
    const q = linking?.q ?? '';
    const titleId = t.id as string;
    const kind = t.kind;
    linking = { q, results: linking?.results ?? null, note: null, busy: true };
    const d = await details(kind, hit.tmdbId);
    const info = d.kind === 'ok' ? d.value : null;
    const poster = info?.posterPath ?? hit.posterPath;
    const year = info?.year ?? hit.year;
    const original = info?.originalTitle ?? hit.originalTitle;
    const r = await write({
      kind: 'LinkToTmdb',
      titleId,
      tmdbId: hit.tmdbId,
      details: {
        ...(original ? { originalTitle: original } : {}),
        ...(year ? { year } : {}),
        ...(poster ? { posterUrl: poster } : {}),
        ...(info && info.genres.length > 0 ? { genres: info.genres } : {}),
        ...(info?.runtimeMin ? { runtimeMin: info.runtimeMin } : {}),
        ...(info?.seasonCount ? { seasonCount: info.seasonCount } : {}),
      },
    });
    if (!r.ok) {
      linking = { q, results: null, note: r.error.kind === 'InvalidInput' ? 'This title is already linked to a different TMDB entry.' : 'Could not link. Try again.', busy: false };
      return;
    }
    linking = null;
    showToast('Linked to TMDB.');
    // If the catalog already had this TMDB title, the two were merged into one entry: open that one.
    const survivor = await findByTmdb(hit.tmdbId, kind);
    if (survivor.ok && survivor.value && survivor.value !== titleId) navigate(`/title/${encodeURIComponent(survivor.value)}`);
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

{#snippet back(href: string)}
  <a class="back" {href} aria-label="Back">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12H5M11 5l-7 7 7 7" /></svg>
  </a>
{/snippet}

{#if detail === undefined}
  <p class="muted">Loading</p>
{:else if detail === null}
  {@render back('#/later')}
  <p class="empty">This title is not on the list any more.</p>
{:else}
  {@const t = detail.title}
  {@render back(`#/${backTab(t.status)}`)}
  <header class="hero">
    <Poster titleId={t.id} path={t.posterUrl} hero />
    <h1>{t.title}</h1>
    <p class="muted">{KIND_LABEL[t.kind]}{t.year ? ` · ${t.year}` : ''}</p>
  </header>

  <section aria-labelledby="ratings-h">
    <h2 id="ratings-h">Ratings</h2>
    <div class="columns">
      {#if mine}
        <div class="col" data-testid="rating-mine">
          <h3>{mine.name} <span class="muted small">(you)</span></h3>
          <div class="stars-tmp" role="group" aria-label="Your rating">
            {#each [2, 4, 6, 8, 10] as n (n)}
              <button type="button" aria-pressed={mine.stars === n} onclick={() => setStars(mine.stars === n ? null : n)}>{n / 2}</button>
            {/each}
          </div>
          <label for="my-review">Your review</label>
          <textarea
            id="my-review"
            rows="2"
            value={draft ?? mine.review ?? ''}
            oninput={(e) => (draft = e.currentTarget.value)}></textarea>
          {#if draft !== null}
            <p class="small muted" class:error={draft.length > REVIEW_MAX}>{draft.length} / {REVIEW_MAX.toLocaleString('en-US')}</p>
            <button type="button" class="primary" onclick={() => void saveReview()}>Save review</button>
          {/if}
        </div>
      {/if}
      {#each others as o (o.memberId)}
        <div class="col" data-testid="rating-partner">
          <h3>{o.name}</h3>
          {#if o.stars || o.review}
            {#if o.stars}<p class="verdict-read" role="img" aria-label={`${o.name}: ${o.stars / 2} stars`}>★ {o.stars / 2}</p>{/if}
            {#if o.review}<p class="review">{o.review}</p>{/if}
          {:else}
            <p class="muted">Not rated yet</p>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="lists-block" aria-labelledby="lists-h">
    <h2 id="lists-h">Lists</h2>

    <div class="who-row" data-testid="list-together">
      <h3>Together</h3>
      {#if viewOnly}
        <p class="muted">{t.status ? STATUS_LABEL[t.status] : 'Not on Together'}{t.status === 'watching' && t.currentSeason ? ` \u00b7 Season ${t.currentSeason}` : ''}{t.watchedOn ? ` \u00b7 ${t.watchedOn}` : ''}</p>
      {:else}
        <div class="seg" role="group" aria-label="Status">
          {#each statusesFor(t.kind) as s (s)}
            <button type="button" aria-pressed={t.status === s} onclick={() => void choose(s)}>{STATUS_LABEL[s]}</button>
          {/each}
        </div>
        {#if t.status === null}<p class="muted small">Not on Together yet.</p>{/if}

        {#if t.status === 'watched' && t.watchedOn === null && !addingDate}
          <div class="date-row">
            <span class="muted" data-testid="date-unknown">Watched · date unknown</span>
            <button type="button" onclick={() => (addingDate = true)}>Add date</button>
          </div>
        {:else if t.status === 'watched' || t.status === 'dropped'}
          <div class="date-row">
            <span class="muted">{t.status === 'dropped' ? 'Dropped on' : 'Watched on'}</span>
            {#if t.watchedOn}<time datetime={t.watchedOn}>{t.watchedOn}</time>{/if}
            <button type="button" aria-pressed={t.watchedOn === todayLocal()} onclick={() => void setStatus(t.status, todayLocal()).then(() => (addingDate = false))}>Today</button>
            <button type="button" aria-pressed={t.watchedOn === yesterdayLocal()} onclick={() => void setStatus(t.status, yesterdayLocal()).then(() => (addingDate = false))}>Yesterday</button>
            <input
              type="date"
              aria-label="Pick a date"
              value={t.watchedOn ?? ''}
              max={todayLocal()}
              onchange={(e) => {
                const v = e.currentTarget.value;
                if (v) void setStatus(t.status, v).then(() => (addingDate = false));
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
      {/if}
    </div>

    {#if myP}
      <div class="who-row" data-testid="list-you">
        <h3>You</h3>
        <div class="seg choice" role="radiogroup" aria-label="Your status">
          <button type="button" role="radio" aria-checked={myP.status === null} tabindex={myP.status === null ? 0 : -1} onclick={() => void chooseMine(null)}>Not on my list</button>
          {#each memberStatusesFor(t.kind) as s (s)}
            <button type="button" role="radio" aria-checked={myP.status === s} tabindex={myP.status === s ? 0 : -1} onclick={() => void chooseMine(s)}>{STATUS_LABEL[s]}</button>
          {/each}
        </div>

        {#if myP.status === 'watched'}
          <div class="date-row" role="group" aria-label="Your watched date">
            <span class="muted">{myP.watchedOn ? 'Watched on' : 'Watched · date unknown'}</span>
            {#if myP.watchedOn}<time datetime={myP.watchedOn}>{myP.watchedOn}</time>{/if}
            <button type="button" aria-pressed={myP.watchedOn === todayLocal()} onclick={() => void setMine('watched', todayLocal())}>Today</button>
            <button type="button" aria-pressed={myP.watchedOn === yesterdayLocal()} onclick={() => void setMine('watched', yesterdayLocal())}>Yesterday</button>
            <button type="button" aria-pressed={myP.watchedOn === null} onclick={() => void setMine('watched')}>Unknown</button>
            <input
              type="date"
              aria-label="Pick your date"
              value={myP.watchedOn ?? ''}
              max={todayLocal()}
              onchange={(e) => {
                const v = e.currentTarget.value;
                if (v) void setMine('watched', v);
              }} />
          </div>
        {/if}

        {#if t.kind === 'series' && myP.status === 'watching'}
          <div class="stepper" role="group" aria-label="Your current season">
            <button type="button" aria-label="Previous season (you)" disabled={!myP.currentSeason || myP.currentSeason <= 1} onclick={() => void stepMine((myP.currentSeason ?? 1) - 1)}>−</button>
            <output>{myP.currentSeason ? `Season ${myP.currentSeason}` : 'No season yet'}</output>
            <button
              type="button"
              aria-label="Next season (you)"
              disabled={t.seasonCount !== null && (myP.currentSeason ?? 0) >= t.seasonCount}
              onclick={() => void stepMine((myP.currentSeason ?? 0) + 1)}>+</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if partnerP}
      <div class="who-row" data-testid="list-partner">
        <h3>{partnerP.name}</h3>
        {#if partnerP.status === null}
          <p class="muted">not on their list</p>
        {:else}
          <p class="muted">{STATUS_LABEL[partnerP.status]}{partnerP.status === 'watching' && partnerP.currentSeason ? ` \u00b7 Season ${partnerP.currentSeason}` : ''}{partnerP.status === 'watched' ? (partnerP.watchedOn ? ` \u00b7 ${partnerP.watchedOn}` : ' \u00b7 date unknown') : ''}</p>
        {/if}
        {#if partnerP.status === null}
          {#if myRec?.state === 'open'}
            <div class="date-row">
              <span class="muted">Recommended</span>
              <button type="button" onclick={() => void run({ kind: 'WithdrawRecommendation', id: myRec.id })}>Withdraw</button>
            </div>
          {:else if myRec?.state === 'dismissed'}
            <p class="muted">Dismissed by {partnerP.name}</p>
          {:else if myRec?.state !== 'accepted'}
            <button type="button" onclick={() => void run({ kind: 'Recommend', titleId: id })}>Recommend to {partnerP.name}</button>
          {/if}
        {/if}
      </div>
    {/if}
  </section>

  {#if t.tmdbId === null}
    <section aria-labelledby="link-h">
      <h2 id="link-h">TMDB</h2>
      {#if tmdb.key === null}
        <p class="muted">Add a TMDB key in Settings to link this title and get its details and poster.</p>
      {:else if !tmdb.online}
        <p class="muted">Linking needs a connection.</p>
      {:else if linking === null}
        <button type="button" onclick={() => (linking = { q: t.title, results: null, note: null, busy: false })}>Link to TMDB</button>
      {:else}
        {@const l = linking}
        <label for="link-q">Search TMDB</label>
        <div class="actions">
          <input id="link-q" autocomplete="off" value={l.q} oninput={(e) => (linking = { ...l, q: e.currentTarget.value })} onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runLinkSearch(); } }} />
          <button type="button" onclick={() => void runLinkSearch()} disabled={l.busy || l.q.trim() === ''}>Search</button>
          <button type="button" onclick={() => (linking = null)}>Cancel</button>
        </div>
        {#if l.note}<p role="status" class="muted">{l.note}</p>{/if}
        {#if l.results}
          <ul class="results" aria-label="TMDB matches">
            {#each l.results as hit (hit.tmdbId)}
              <li class="result">
                <span class="meta">
                  <span class="name">{hit.title}</span>
                  <span class="muted small">{KIND_LABEL[hit.mediaKind]}{hit.year ? ` · ${hit.year}` : ''}</span>
                </span>
                <button type="button" class="primary" disabled={l.busy} onclick={() => void link(hit)}>{`Link ${hit.title}${hit.year ? ` (${hit.year})` : ''}`}</button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}

  <p role="alert" class="error">{error ?? ''}</p>

  {#if !viewOnly}
    <section>
      <button type="button" class="danger" onclick={() => void remove()}>Remove from list</button>
    </section>
  {/if}
{/if}
