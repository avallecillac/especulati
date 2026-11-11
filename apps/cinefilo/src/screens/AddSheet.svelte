<script lang="ts">
  import type { Kind, Status } from '@especulati/cinefilo-core';
  import { todayLocal } from '../lib/clock.ts';
  import { KIND_LABEL, STATUS_LABEL, statusesFor } from '../lib/labels.ts';
  import { navigate } from '../lib/router.svelte.ts';
  import { showToast, write } from '../lib/state.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();

  let title = $state('');
  let kind = $state<Kind>('movie');
  let year = $state('');
  let status = $state<Status>('later');
  let watchedOn = $state<string>(todayLocal());
  let error = $state<string | null>(null);
  let busy = $state(false);

  const statuses = $derived(statusesFor(kind));
  const needsDate = $derived(status === 'watched' || status === 'dropped');

  function setKind(k: Kind) {
    kind = k;
    if (!statusesFor(k).includes(status)) status = 'later';
  }

  async function save() {
    error = null;
    const trimmed = year.trim();
    const y = trimmed === '' ? null : Number(trimmed);
    if (y !== null && !Number.isInteger(y)) return void (error = 'The year must be a number.');
    busy = true;
    const r = await write({
      kind: 'AddTitle',
      mediaKind: kind,
      title,
      ...(y !== null ? { year: y } : {}),
      status,
      ...(needsDate ? { watchedOn } : {}),
    });
    busy = false;
    if (r.ok) return void onclose();
    const e = r.error;
    if (e.kind === 'AlreadyExists') {
      // The same title is already in the catalog: open it instead of adding a second one.
      const id = e.id;
      onclose();
      showToast('Already on your list.');
      navigate(`/title/${encodeURIComponent(id)}`);
    } else if (e.kind === 'TitleRequired') error = 'A title is required.';
    else if (e.kind === 'InvalidInput') error = `${e.field}: ${e.reason}`;
    else error = 'Could not save. Try again.';
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Add a title">
  <div class="grabber" aria-hidden="true"></div>
  <h2>Add a title</h2>

  <!-- Group 6 (TMDB): the search field, the Movie/Series toggle and the result rows with a 1-tap Add go here,
       above "Add by hand". Without a key, offline or on failure the sheet shows only the form below. -->

  <form onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <label for="add-title">Title</label>
    <input id="add-title" autocomplete="off" bind:value={title} />

    <fieldset>
      <legend>Kind</legend>
      <div class="seg">
        {#each ['movie', 'series'] as const as k (k)}
          <button type="button" aria-pressed={kind === k} onclick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        {/each}
      </div>
    </fieldset>

    <label for="add-year">Year</label>
    <input id="add-year" inputmode="numeric" autocomplete="off" placeholder="Optional" bind:value={year} />

    <label for="add-status">Status</label>
    <select id="add-status" bind:value={status}>
      {#each statuses as s (s)}
        <option value={s}>{STATUS_LABEL[s]}</option>
      {/each}
    </select>

    {#if needsDate}
      <label for="add-date">Date</label>
      <input id="add-date" type="date" bind:value={watchedOn} />
    {/if}

    <p role="alert" class="error">{error ?? ''}</p>
    <div class="actions">
      <button class="primary" type="submit" disabled={busy}>Add title</button>
      <button type="button" onclick={onclose}>Cancel</button>
    </div>
  </form>
</div>
