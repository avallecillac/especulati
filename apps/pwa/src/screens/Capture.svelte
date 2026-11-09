<script lang="ts">
  import { untrack } from 'svelte';
  import { readingMinutes, type Article } from '@readerlog/core';
  import { dispatch, query } from '../lib/dbClient.ts';
  import { captureId, decodeCapture, highlightCaptureId, saveCaptureId, type Capture, type CaptureProblem } from '../lib/capture.ts';
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
    | { kind: 'saved'; capture: Capture; id: string; fresh: boolean }
    /** Save mode (008). `readOn`: the date this URL was already read, when it was. */
    | { kind: 'later'; capture: Capture; id: string; fresh: boolean; readOn: string | null }
    /** Highlight mode (007). `articleNew`: this link logged the article, so Undo removes it too. */
    | { kind: 'highlighted'; capture: Capture; hid: string; itemId: string; articleNew: boolean; fresh: boolean; note: string | null };

  const UNDO_MS = 6000;

  /** What to fix in the Shortcut (docs/ios-shortcut.md). Names fields, never shows their values. */
  const PROBLEM: Record<CaptureProblem, string> = {
    encoding:
      "The link's data is incomplete or couldn't be read. In the Shortcut, set Base64 Encode's Line Breaks to None, then URL Encode.",
    v: 'The “v” value must be the number 1.',
    url: 'The “url” value isn’t a web address. It should be the Shortcut Input.',
    quote: 'The passage is too long (5,000 characters max).',
    at: 'The “at” value must be a date with a time. In Format Date, choose ISO 8601 and turn on Include ISO 8601 Time.',
  };

  let phase = $state<Phase>({ kind: 'working' });
  let canUndo = $state(false);
  let removed = $state(false);
  let noting = $state(false);
  let noteText = $state('');
  let noteBusy = $state(false);
  let noteError = $state('');
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

  /** Push now rather than after the write delay; without sync, the Finish setup prompt shows. */
  async function push() {
    await refreshStatus();
    if (syncState.on) await runSync('manual');
  }

  /** Save mode, contracts/capture-008.md: a live saved match is "Already saved"; a read match still saves anew. */
  async function runSave(c: Capture) {
    const saved = await query({ name: 'findSavedByUrl', url: c.url });
    if (!saved.ok) return void (phase = { kind: 'error', message: errorMessage(saved.error) });
    const id = await saveCaptureId(c);
    if (saved.value[0]) {
      phase = { kind: 'later', capture: c, id: saved.value[0].id, fresh: false, readOn: null };
      return void (await refreshStatus());
    }
    const read = await query({ name: 'findArticleByUrl', url: c.url });
    if (!read.ok) return void (phase = { kind: 'error', message: errorMessage(read.error) });
    const readOn = read.value[0]?.readOn ?? null;
    const r = await dispatch({
      kind: 'AddArticle',
      itemId: id,
      url: c.url,
      title: c.title,
      author: c.author,
      wordCount: c.wordCount,
      detailsStatus: 'complete',
    });
    // AlreadyExists: this very link was saved and then undone; it stays removed, as in an article capture.
    if (!r.ok && r.error.kind !== 'AlreadyExists') return void (phase = { kind: 'error', message: errorMessage(r.error) });
    phase = { kind: 'later', capture: c, id, fresh: r.ok, readOn };
    if (r.ok) {
      canUndo = true;
      undoTimer = setTimeout(() => (canUndo = false), UNDO_MS);
    }
    await push();
  }

  /** Highlight mode, steps 2-5 of contracts/capture-highlight.md. */
  async function runHighlight(c: Capture, quote: string) {
    const found = await query({ name: 'findArticleByUrl', url: c.url });
    if (!found.ok) return void (phase = { kind: 'error', message: errorMessage(found.error) });
    // A live match is used, with no prompt; a removed one is not in the result, so it is logged anew.
    let itemId = found.value[0]?.id ?? '';
    let articleNew = false;
    const hid = await highlightCaptureId(c.url, c.at);
    if (itemId === '') {
      itemId = await captureId(c);
      const added = await dispatch({
        kind: 'AddArticle',
        itemId,
        url: c.url,
        title: c.title,
        author: c.author,
        wordCount: c.wordCount,
        readOn: todayLocal(),
        detailsStatus: 'complete',
      });
      if (!added.ok) {
        if (added.error.kind !== 'AlreadyExists') return void (phase = { kind: 'error', message: errorMessage(added.error) });
        // This very link was already undone: the article stays removed, as in an article capture.
        phase = { kind: 'highlighted', capture: c, hid, itemId, articleNew: false, fresh: false, note: c.note };
        return void (await refreshStatus());
      }
      articleNew = true;
    }
    const r = await dispatch({ kind: 'AddHighlight', highlightId: hid, itemId, quote, note: c.note, localDate: todayLocal() });
    if (!r.ok && r.error.kind !== 'AlreadyExists') {
      if (articleNew) await dispatch({ kind: 'RemoveArticle', itemId });
      return void (phase = { kind: 'error', message: errorMessage(r.error) });
    }
    phase = { kind: 'highlighted', capture: c, hid, itemId, articleNew, fresh: r.ok, note: c.note };
    if (r.ok) {
      canUndo = true;
      undoTimer = setTimeout(() => (canUndo = false), UNDO_MS);
    }
    await push();
  }

  async function saveNote(p: Extract<Phase, { kind: 'highlighted' }>) {
    const text = noteText;
    const hid = p.hid;
    noteBusy = true;
    const r = await dispatch({ kind: 'EditHighlightNote', highlightId: hid, note: text });
    noteBusy = false;
    if (!r.ok) return void (noteError = errorMessage(r.error));
    noting = false;
    noteError = '';
    phase = { ...p, note: text.trim() === '' ? null : text.trim() };
    await push();
  }

  async function undoHighlight(p: Extract<Phase, { kind: 'highlighted' }>) {
    const hid = p.hid;
    const itemId = p.itemId;
    const articleNew = p.articleNew;
    clearTimeout(undoTimer);
    canUndo = false;
    noting = false;
    let r = await dispatch({ kind: 'RemoveHighlight', highlightId: hid });
    if (r.ok && articleNew) r = await dispatch({ kind: 'RemoveArticle', itemId });
    if (r.ok) removed = true;
    else phase = { kind: 'error', message: errorMessage(r.error) };
    await push();
  }

  async function run() {
    const parsed = decodeCapture(d);
    if (!parsed.ok) return void (phase = { kind: 'damaged', problem: parsed.error.reason });
    const c = parsed.value;
    if (c.quote !== null) return runHighlight(c, c.quote);
    if (c.later) return runSave(c);
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
{:else if phase.kind === 'highlighted'}
  {@const p = phase}
  <section class="card">
    {#if removed}
      <p role="status"><strong>Removed</strong></p>
    {:else}
      <p role="status"><strong>{p.fresh ? 'Highlight saved' : 'Already saved'}</strong></p>
      <blockquote>{p.capture.quote}</blockquote>
      {#if p.note}<p class="note">{p.note}</p>{/if}
      <p class="muted">{p.capture.title} · {p.capture.site}</p>
      {#if noting}
        <form onsubmit={(e) => { e.preventDefault(); void saveNote(p); }} novalidate>
          <label for="cap-note">Note</label>
          <!-- svelte-ignore a11y_autofocus -->
          <textarea id="cap-note" rows="3" bind:value={noteText} autofocus></textarea>
          <p role="alert" class="error">{noteError}</p>
          <div class="actions">
            <button class="primary" type="submit" disabled={noteBusy || noteText.trim() === ''}>Save</button>
            <button type="button" onclick={() => { noting = false; noteError = ''; }}>Cancel</button>
          </div>
        </form>
      {/if}
    {/if}
    {#if !removed && !syncState.on}
      <p class="muted">
        <strong>Finish setup:</strong>
        <a href="#/settings/sync">join your sync space</a> to send this to your other devices.
      </p>
    {/if}
    {#if !noting}
      <div class="actions">
        {#if !removed && p.fresh && !p.note}<button type="button" onclick={() => { noteText = ''; noting = true; }}>Add note</button>{/if}
        {#if canUndo && !removed}<button type="button" onclick={() => void undoHighlight(p)}>Undo</button>{/if}
        <button class="primary" type="button" onclick={() => navigate('/library')}>Done</button>
      </div>
    {/if}
  </section>
{:else if phase.kind === 'later'}
  {@const p = phase}
  <section class="card">
    {#if removed}
      <p role="status"><strong>Removed</strong></p>
    {:else}
      <p role="status"><strong>{p.fresh ? 'Saved for later' : 'Already saved'}</strong></p>
      <p class="muted">{p.capture.title} · {p.capture.site}{minutes(p.capture)}</p>
      {#if p.readOn}<p class="muted">You read this on {longDate(p.readOn)}</p>{/if}
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

<style>
  textarea {
    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; resize: vertical;
    border: 0.5px solid var(--rule); background: var(--leaf); color: var(--ink); font-family: var(--font-text); line-height: 1.45;
  }
  blockquote {
    margin: 12px 0; padding-left: 14px; border-left: 2px solid var(--ornament);
    font-family: var(--font-text); font-style: italic; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere;
    max-height: 40vh; overflow-y: auto;
  }
  .note { margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
</style>
