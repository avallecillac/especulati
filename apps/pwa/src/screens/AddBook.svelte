<script lang="ts">
  import type { ClientError } from '../lib/protocol.ts';
  import { dispatch, query, storeCover } from '../lib/dbClient.ts';
  import { authorsLabel } from '../catalog/merge.ts';
  import { fetchCover } from '../catalog/cover.ts';
  import { parseIsbn, type DetailsStatus, type Isbn13 } from '@readerlog/core';
  import { lookupIsbn } from '../catalog/isbnLookup.ts';
  import type { BookDetails } from '../catalog/types.ts';
  import { clearDraft, draft, type Draft } from '../lib/draft.svelte.ts';
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

  // Edit mode (US5): an ISBN, a lookup, and the fetched fields the user chooses to apply.
  type Row = 'title' | 'author' | 'totalPages' | 'genre' | 'cover';
  let isbnText = $state('');
  let isbnInvalid = $state(false);
  let editLookup = $state<Draft['lookup']>('idle');
  let fetched = $state<BookDetails | null>(null);
  let picked = $state<Record<Row, boolean>>({ title: false, author: false, totalPages: false, genre: false, cover: false });
  let current = $state({ title: '', author: '', totalPages: '', genre: '', hasCover: false });
  let lookupToken = 0;

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
        isbnText = c.isbn ?? '';
        current = { title, author, totalPages, genre, hasCover: c.hasCover };
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

  const lookupText = (lookup: Draft['lookup'], details: BookDetails | null | undefined) => {
    if (lookup === 'running') return 'Looking up…';
    if (lookup === 'found') return details?.source === 'googlebooks' ? 'Found in Google Books' : 'Found in Open Library';
    if (lookup === 'idle') return null;
    if (lookup === 'notFound') return 'Not found in book catalogs — add the details yourself.';
    if (lookup === 'timeout') return 'Taking too long — continue without details.';
    return "Details will be looked up when you're online.";
  };
  const lookupLine = $derived.by(() => {
    const d = draft.current;
    return !d || editId !== undefined ? null : lookupText(d.lookup, d.details);
  });
  const editLine = $derived(lookupText(editLookup, fetched));

  const fetchedAuthor = $derived(fetched ? authorsLabel(fetched.authors) : null);
  const rows = $derived.by(() => {
    const f = fetched;
    if (!f) return [];
    const out: { key: Row; label: string; now: string; next: string }[] = [];
    if (f.title) out.push({ key: 'title', label: 'Title', now: current.title, next: f.title });
    if (fetchedAuthor) out.push({ key: 'author', label: 'Author', now: current.author, next: fetchedAuthor });
    if (f.totalPages !== null) out.push({ key: 'totalPages', label: 'Total pages', now: current.totalPages, next: String(f.totalPages) });
    if (f.genre) out.push({ key: 'genre', label: 'Genre', now: current.genre, next: f.genre });
    if (f.coverUrl) out.push({ key: 'cover', label: 'Cover', now: current.hasCover ? 'stored cover' : 'generated cover', next: 'fetched cover' });
    return out;
  });

  async function lookUp() {
    const parsed = parseIsbn(isbnText);
    isbnInvalid = !parsed.ok;
    if (!parsed.ok) return;
    const mine = ++lookupToken;
    editLookup = 'running';
    fetched = null;
    const outcome = await lookupIsbn(parsed.value as Isbn13, { fetch: (u, i) => fetch(u, i), online: () => navigator.onLine });
    if (mine !== lookupToken) return;
    editLookup = outcome.kind;
    picked = { title: false, author: false, totalPages: false, genre: false, cover: false };
    if (outcome.kind === 'found') fetched = outcome.details;
  }

  /** Saving before the lookup resolves, or after it couldn't help, leaves the details pending. */
  const statusToSave = (lookup: Draft['lookup']): DetailsStatus =>
    lookup === 'found' ? 'complete' : lookup === 'notFound' ? 'notFound' : 'pending';

  /** '' → null (not given); anything else → a number, which decide() validates. */
  const pagesValue = () => (totalPages.trim() === '' ? null : Number(totalPages));

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    if (editId !== undefined) return saveEdit(editId);
    saving = true;
    const itemId = crypto.randomUUID();
    const d = editId === undefined ? draft.current : null;
    const coverUrl = d?.details?.coverUrl ?? null;
    const r = await dispatch({
      kind: 'AddBook',
      itemId,
      title,
      author,
      totalPages: pagesValue(),
      genre,
      ...(d?.isbn ? { isbn: d.isbn, coverUrl, detailsStatus: statusToSave(d.lookup) } : {}),
      startNow,
      startEventId: crypto.randomUUID(),
      localDate: todayLocal(),
    });
    saving = false;
    if (!r.ok) {
      error = r.error;
      return;
    }
    if (coverUrl) storeCoverInBackground(itemId, coverUrl);
    clearDraft();
    navigate('/');
  }

  /** Fire and forget: saving never waits on the network. */
  const storeCoverInBackground = (itemId: string, url: string) =>
    void fetchCover(url, { fetch: (u, i) => fetch(u, i) }).then((blob) => (blob ? storeCover(itemId, blob) : null));

  /** The form's fields, with each checked fetched field overriding its form field. */
  async function saveEdit(id: string) {
    const parsed = isbnText.trim() === '' ? null : parseIsbn(isbnText);
    isbnInvalid = parsed !== null && !parsed.ok;
    if (isbnInvalid) return;
    const f = fetched;
    const use = (k: Row) => f !== null && picked[k] && rows.some((r) => r.key === k);
    const coverUrl = f !== null && use('cover') ? f.coverUrl : null;
    saving = true;
    const r = await dispatch({
      kind: 'EditBook',
      itemId: id,
      title: use('title') && f?.title ? f.title : title,
      author: use('author') && fetchedAuthor ? fetchedAuthor : author,
      totalPages: use('totalPages') && f?.totalPages != null ? f.totalPages : pagesValue(),
      genre: use('genre') && f?.genre ? f.genre : genre,
      isbn: parsed?.ok ? parsed.value : null,
      ...(coverUrl ? { coverUrl } : {}),
      detailsStatus: 'complete',
    });
    saving = false;
    if (!r.ok) {
      error = r.error;
      return;
    }
    if (coverUrl) storeCoverInBackground(id, coverUrl);
    navigate(`/book/${id}`);
  }
</script>

<h1>{editId === undefined ? 'Add a book' : 'Edit book'}</h1>

{#if editId === undefined}
  <div class="actions add-sources">
    <button type="button" class="primary" onclick={() => navigate('/scan')}>Scan barcode</button>
    <div class="row">
      <a href="#/search">Search by title</a>
      <a href="#/isbn">Enter ISBN</a>
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
    {:else}
      <label for="isbn">ISBN</label>
      <input
        id="isbn"
        type="text"
        inputmode="text"
        autocomplete="off"
        bind:value={isbnText}
        oninput={() => { isbnInvalid = false; lookupToken++; fetched = null; editLookup = 'idle'; }}
        aria-invalid={isbnInvalid}
        aria-describedby={isbnInvalid ? 'isbn-error' : undefined}
      />
      {#if isbnInvalid}<p id="isbn-error" class="error">That isn't a valid ISBN — check the digits.</p>{/if}
      <div class="actions">
        <button type="button" disabled={editLookup === 'running'} onclick={() => void lookUp()}>Look up details</button>
      </div>
      {#if editLine}<p role="status">{editLine}</p>{/if}
      {#if rows.length > 0}
        <div role="group" aria-label="Fetched details">
          {#each rows as row (row.key)}
            <div class="row">
              <label class="check"><input type="checkbox" bind:checked={picked[row.key]} /> {row.label}</label>
              <span class="muted">{row.now || '—'} → {row.next}</span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    {#if fieldOf(error) === 'form' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <div class="actions">
      <button class="primary" type="submit" disabled={saving}>Save book</button>
    </div>
  </form>
{/if}
