<script lang="ts">
  import type { ClientError } from '../lib/protocol.ts';
  import { dispatch, query } from '../lib/dbClient.ts';
  import { todayLocal } from '../lib/clock.ts';
  import { errorMessage } from '../lib/errors.ts';
  import { navigate } from '../lib/router.svelte.ts';

  import { untrack } from 'svelte';

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

  /** '' → null (not given); anything else → a number, which decide() validates. */
  const pagesValue = () => (totalPages.trim() === '' ? null : Number(totalPages));

  async function save(ev: SubmitEvent) {
    ev.preventDefault();
    saving = true;
    const r = editId === undefined
      ? await dispatch({
          kind: 'AddBook',
          itemId: crypto.randomUUID(),
          title,
          author,
          totalPages: pagesValue(),
          genre,
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
    navigate(editId === undefined ? '/' : `/book/${editId}`);
  }
</script>

<h1>{editId === undefined ? 'Add a book' : 'Edit book'}</h1>

{#if loaded}
  <form onsubmit={save} novalidate>
    <label for="title">Title</label>
    <input id="title" type="text" bind:value={title} autocomplete="off" required aria-invalid={fieldOf(error) === 'title'} />
    {#if fieldOf(error) === 'title' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <label for="author">Author</label>
    <input id="author" type="text" bind:value={author} autocomplete="off" />

    <label for="pages">Total pages</label>
    <input id="pages" type="text" inputmode="numeric" bind:value={totalPages} aria-invalid={fieldOf(error) === 'pages'} />
    {#if fieldOf(error) === 'pages' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <label for="genre">Genre</label>
    <input id="genre" type="text" bind:value={genre} autocomplete="off" />

    {#if editId === undefined}
      <label class="check"><input type="checkbox" bind:checked={startNow} /> Start reading now</label>
    {/if}

    {#if fieldOf(error) === 'form' && error}<p class="error">{errorMessage(error)}</p>{/if}

    <div class="actions">
      <button class="primary" type="submit" disabled={saving}>Save book</button>
    </div>
  </form>
{/if}
