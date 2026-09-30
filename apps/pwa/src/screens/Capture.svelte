<script lang="ts">
  import { untrack } from 'svelte';
  import { readingMinutes, type Article } from '@readerlog/core';
  import { dispatch, query } from '../lib/dbClient.ts';
  import { captureId, decodeCapture, type Capture, type CaptureProblem } from '../lib/capture.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { longDate } from '../lib/dates.ts';
  import { errorMessage } from '../lib/errors.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { refreshStatus, runSync, syncState } from '../lib/sync.svelte.ts';

  /** The `#/capture?d=…` screen (contracts/capture.md). The route is keyed on `d` in App.svelte. */
  let props: { d: string } = $props();
  const d = untrack(() => props.d);

  type Phase =
    | { kind: 'working' }
    | { kind: 'damaged'; problem: CaptureProblem }
    | { kind: 'error'; message: string }
    | { kind: 'duplicate'; capture: Capture; id: string; loggedOn: string }
    | { kind: 'saved'; capture: Capture; id: string; fresh: boolean };

  const UNDO_MS = 6000;

  /** What to fix in the Shortcut (docs/ios-shortcut.md). Names fields, never shows their values. */
  const PROBLEM: Record<CaptureProblem, string> = {
    encoding:
      "The link's data is incomplete or couldn't be read. In the Shortcut, set Base64 Encode's Line Breaks to None, then URL Encode.",
    v: 'The “v” value must be the number 1.',
    url: 'The “url” value isn’t a web address. It should be the Shortcut Input.',
    at: 'The “at” value must be a date with a time. In Format Date, choose ISO 8601 and turn on Include ISO 8601 Time.',
  };

  let phase = $state<Phase>({ kind: 'working' });
  let canUndo = $state(false);
  let removed = $state(false);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  async function save(c: Capture, id: string) {
    const r = await dispatch({
      kind: 'AddArticle',
      itemId: id,
      url: c.url,
      title: c.title,
      author: c.author,
      wordCount: c.wordCount,
      readOn: todayLocal(),
      detailsStatus: 'complete',
    });
    if (!r.ok && r.error.kind !== 'AlreadyExists') return void (phase = { kind: 'error', message: errorMessage(r.error) });
    phase = { kind: 'saved', capture: c, id, fresh: r.ok };
    if (r.ok) {
      canUndo = true;
      undoTimer = setTimeout(() => (canUndo = false), UNDO_MS);
    }
    // Push now rather than after the 3 s write delay: this tab may be closed right away (research R1).
    await refreshStatus();
    if (syncState.on) await runSync('manual');
  }

  async function run() {
    const parsed = decodeCapture(d);
    if (!parsed.ok) return void (phase = { kind: 'damaged', problem: parsed.error.reason });
    const c = parsed.value;
    const id = await captureId(c);
    const found = await query({ name: 'findArticleByUrl', url: c.url });
    if (!found.ok) return void (phase = { kind: 'error', message: errorMessage(found.error) });
    const matches: Article[] = found.value;
    // Opening the same link again is not a duplicate of itself: it is "Already saved" (FR-010).
    if (matches.some((a) => a.id === id)) {
      phase = { kind: 'saved', capture: c, id, fresh: false };
      await refreshStatus();
      return;
    }
    if (matches[0]) return void (phase = { kind: 'duplicate', capture: c, id, loggedOn: matches[0].readOn });
    await save(c, id);
  }
  void run();

  async function undo(id: string) {
    clearTimeout(undoTimer);
    canUndo = false;
    const r = await dispatch({ kind: 'RemoveArticle', itemId: id });
    if (r.ok) removed = true;
    else phase = { kind: 'error', message: errorMessage(r.error) };
    await refreshStatus();
    if (syncState.on) await runSync('manual');
  }

  const minutes = (c: Capture): string => {
    const m = readingMinutes(c.wordCount);
    return m === null ? '' : ` · ~${m} min`;
  };
</script>

<h1>Capture</h1>

{#if phase.kind === 'working'}
  <p class="muted" role="status">Saving…</p>
{:else if phase.kind === 'damaged'}
  <section class="card">
    <p role="alert"><strong>This capture link is damaged</strong></p>
    <p>{PROBLEM[phase.problem]}</p>
    <p class="muted">Nothing was saved. You can add the article by hand.</p>
    <div class="actions"><a class="button primary" href="#/articles">Add article</a></div>
  </section>
{:else if phase.kind === 'error'}
  <section class="card"><p role="alert" class="error">{phase.message}</p></section>
{:else if phase.kind === 'duplicate'}
  {@const p = phase}
  <section class="card">
    <p><strong>Already logged on {longDate(p.loggedOn)}</strong></p>
    <p class="muted">{p.capture.title} · {p.capture.site}</p>
    <div class="actions">
      <button class="primary" type="button" onclick={() => void save(p.capture, p.id)}>Log again</button>
      <button type="button" onclick={() => navigate('/library')}>Cancel</button>
    </div>
  </section>
{:else if phase.kind === 'saved'}
  {@const p = phase}
  <section class="card">
    {#if removed}
      <p role="status"><strong>Removed</strong></p>
    {:else if p.fresh}
      <p role="status"><strong>Logged: {p.capture.title} · {p.capture.site}{minutes(p.capture)}</strong></p>
    {:else}
      <p role="status"><strong>Already saved</strong></p>
      <p class="muted">{p.capture.title} · {p.capture.site}</p>
    {/if}
    {#if !removed && !syncState.on}
      <p class="muted">
        <strong>Finish setup:</strong>
        <a href="#/settings/sync">join your sync space</a> to send this to your other devices.
      </p>
    {/if}
    <div class="actions">
      {#if canUndo && !removed}<button type="button" onclick={() => void undo(p.id)}>Undo</button>{/if}
      <button class="primary" type="button" onclick={() => navigate('/library')}>Done</button>
    </div>
  </section>
{/if}
