<script lang="ts">
  import type { ClientError } from '../lib/protocol.ts';
  import { dispatch, query, storeCover } from '../lib/dbClient.ts';
  import { authorsLabel } from '../catalog/merge.ts';
  import { fetchCover } from '../catalog/cover.ts';
  import { clearDraft, draft } from '../lib/draft.svelte.ts';
  import Cover from './Cover.svelte';
  import { todayLocal } from '../lib/clock.ts';
  import { errorMessage } from '../lib/errors.ts';
  import { navigate } from '../lib/router.svelte.ts';

  import { onDestroy, untrack } from 'svelte';

  let props: { editId?: string } = $props();
  // The route is keyed on the id ({#key} in App.svelte), so the initial value is the value.
  const editId = untrack(() => props.editId);

  let title = $state('');
  let author = $state('');
  let totalPages = $state('');
  let genre = $state('');
  let startNow = $state(true);
  let saving = $state(false);
  let error = $state<ClientError | null>(null);
  let loaded = $state(editId === undefined);

  const fieldOf = (e: ClientError | null) =>
    e === null ? null
    : e.kind === 'TitleRequired' ? 'title'
    : e.kind === 'InvalidPageCount' || e.kind === 'PagesBelowLogged' ? 'pages'
    : 'form';

  if (editId !== undefined) {
    void query({ name: 'book', itemId: editId }).then((r) => {
      if (r.ok && r.value) {
        const c = r.value.card;
        title = c.title;
        author = c.author ?? '';
        totalPages = c.totalPages === null ? '' : String(c.totalPages);
        genre = c.genre ?? '';
      }
      loaded = true;
    });
  }

  // Prefill from a scan/ISBN draft once, without clobbering what the user already typed.
  const touched = new Set<string>();
  let applied: unknown = null;
  $effect(() => {
    const d = draft.current?.details;
    if (editId !== undefined || !d || d === applied) return;
    applied = d;
    if (!touched.has('title') && d.title) title = d.title;
    if (!touched.has('author')) author = authorsLabel(d.authors) ?? author;
    if (!touched.has('pages') && d.totalPages !== null) totalPages = String(d.totalPages);
    if (!touched.has('genre') && d.genre) genre = d.genre;
  });

  // Leaving Add without saving drops the draft, so the next visit starts blank.
  onDestroy(() => {
    if (editId === undefined) clearDraft();
  });

  const lookupLine = $derived.by(() => {
    const d = draft.current;
    if (!d || editId !== undefined) return null;
    if (d.lookup === 'running') return 'Looking up…';
    if (d.lookup === 'found') return d.details?.source === 'googlebooks' ? 'Found in Google Books' : 'Found in Open Library';
    if (d.lookup === 'idle') return null;
    return "Couldn't fetch details.";
  });

  /** '' → null (not given); anything else → a number, which decide() validates. */
  const pagesValue = () => (totalPages.trim() === '' ? null : Number(totalPages));

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    saving = true;
    const itemId = crypto.randomUUID();
    const d = editId === undefined ? draft.current : null;
    const coverUrl = d?.details?.coverUrl ?? null;
    const r = editId === undefined
      ? await dispatch({
          kind: 'AddBook',
          itemId,
          title,
          author,
          totalPages: pagesValue(),
          genre,
          ...(d?.isbn ? { isbn: d.isbn, coverUrl, detailsStatus: 'complete' as const } : {}),
          startNow,
          startEventId: crypto.randomUUID(),
          localDate: todayLocal(),
        })
      : await dispatch({ kind: 'EditBook', itemId: editId, title, author, totalPages: pagesValue(), genre });
    saving = false;
    if (!r.ok) {
      error = r.error;
      return;
    }
    if (editId === undefined && coverUrl) {
      // Fire and forget: saving never waits on the network.
      void fetchCover(coverUrl, { fetch: (u, i) => fetch(u, i) }).then((blob) => (blob ? storeCover(itemId, blob) : null));
    }
    if (editId === undefined) clearDraft();
    navigate(editId === undefined ? '/' : `/book/${editId}`);
  }
</script>

<h1>{editId === undefined ? 'Add a book' : 'Edit book'}</h1>

{#if editId === undefined}
  <div class="actions add-sources">
    <button type="button" class="primary" onclick={() => navigate('/scan')}>Scan barcode</button>
    <div class="row">
      <span class="link disabled" role="link" aria-disabled="true">Search by title</span>
      <span class="link disabled" role="link" aria-disabled="true">Enter ISBN</span>
    </div>
  </div>
{/if}

{#if draft.current && editId === undefined}
  <div class="with-cover">
    <Cover url={draft.current.details?.coverUrl ?? null} title={title || draft.current.details?.title || 'new book'} size="md" />
    <div>
      {#if draft.current.isbn}<p class="muted">ISBN {draft.current.isbn}</p>{/if}
      {#if lookupLine}<p role="status">{lookupLine}</p>{/if}
    </div>
  </div>
{/if}

{#if loaded}
  <form onsubmit={save} novalidate>
    <label for="title">Title</label>
    <input id="title" oninput={() => touched.add('title')} type="text" bind:value={title} autocomplete="off" required aria-invalid={fieldOf(error) === 'title'} />
    {#if fieldOf(error) === 'title' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <label for="author">Author</label>
    <input id="author" oninput={() => touched.add('author')} type="text" bind:value={author} autocomplete="off" />

    <label for="pages">Total pages</label>
    <input id="pages" oninput={() => touched.add('pages')} type="text" inputmode="numeric" bind:value={totalPages} aria-invalid={fieldOf(error) === 'pages'} />
    {#if fieldOf(error) === 'pages' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <label for="genre">Genre</label>
    <input id="genre" oninput={() => touched.add('genre')} type="text" bind:value={genre} autocomplete="off" />

    {#if editId === undefined}
      <label class="check"><input type="checkbox" bind:checked={startNow} /> Start reading now</label>
    {/if}

    {#if fieldOf(error) === 'form' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <div class="actions">
      <button class="primary" type="submit" disabled={saving}>Save book</button>
    </div>
  </form>
{/if}
