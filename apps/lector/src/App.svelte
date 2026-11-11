<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { query, refreshAll } from './lib/dbClient.ts';
  import { loadSettings } from './lib/settings.svelte.ts';
  import { runDetailsRetry } from './lib/detailsRetry.ts';
  import { startSync } from './lib/sync.svelte.ts';
  import { applyUpdate, pwa } from './lib/pwa.svelte.ts';
  import { dismissToast, toasts } from './lib/toast.svelte.ts';
  import TopBar from './shell/TopBar.svelte';
  import TabBar from './shell/TabBar.svelte';
  import Home from './screens/Home.svelte';
  import AddBook from './screens/AddBook.svelte';
  import Scan from './screens/Scan.svelte';
  import Search from './screens/Search.svelte';
  import EnterIsbn from './screens/EnterIsbn.svelte';
  import Library from './screens/Library.svelte';
  import BookDetail from './screens/BookDetail.svelte';
  import Stats from './screens/Stats.svelte';
  import Settings from './screens/Settings.svelte';
  import Duplicates from './screens/Duplicates.svelte';
  import Sync from './screens/Sync.svelte';
  import Article from './screens/Article.svelte';
  import Capture from './screens/Capture.svelte';

  // Signals (to users of assistive tech and to tests) that the on-device DB is open.
  let dbReady = $state(false);
  let busy = $state(false);

  async function connect() {
    const wasBusy = busy;
    const r = await query({ name: 'storage' });
    dbReady = r.ok;
    busy = !r.ok && r.error.kind === 'Busy';
    if (wasBusy && r.ok) refreshAll();
  }
  void connect();

  let retried = false;
  $effect(() => {
    if (dbReady && !retried) {
      retried = true;
      // Load settings first so the retry's Google requests carry the key.
      void loadSettings().then(() => runDetailsRetry());
      void startSync();
    }
  });

  // Another window had the DB: try again when this one is brought to the front.
  const retry = () => {
    if (busy && document.visibilityState === 'visible') void connect();
  };
</script>

<svelte:window onfocus={retry} ononline={() => void runDetailsRetry()} />
<svelte:document onvisibilitychange={retry} />

<div class="app">
  {#if dbReady}<div data-testid="ready" hidden></div>{/if}
  <TopBar />

  {#if busy}
    <div class="update" role="alert">Lector is open in another window. Close it or switch to it.</div>
  {/if}

  {#if pwa.needRefresh}
    <div class="update row" role="status">
      <span>Update available.</span>
      <span class="spacer"></span>
      <button class="link" onclick={applyUpdate}>Reload</button>
    </div>
  {/if}

  <main>
    {#if router.route.name === 'home'}
      <Home />
    {:else if router.route.name === 'add'}
      <AddBook />
    {:else if router.route.name === 'scan'}
      <Scan />
    {:else if router.route.name === 'search'}
      <Search />
    {:else if router.route.name === 'isbn'}
      <EnterIsbn />
    {:else if router.route.name === 'edit'}
      {#key router.route.id}<AddBook editId={router.route.id} />{/key}
    {:else if router.route.name === 'library'}
      <Library />
    {:else if router.route.name === 'book'}
      {#key router.route.id}<BookDetail id={router.route.id} />{/key}
    {:else if router.route.name === 'articles'}
      <Library initialTab="articles" />
    {:else if router.route.name === 'article'}
      {#key router.route.id}<Article id={router.route.id} />{/key}
    {:else if router.route.name === 'capture'}
      {#key router.route.d}<Capture d={router.route.d} />{/key}
    {:else if router.route.name === 'stats'}
      <Stats />
    {:else if router.route.name === 'settings'}
      <Settings />
    {:else if router.route.name === 'sync'}
      <Sync />
    {:else if router.route.name === 'duplicates'}
      <Duplicates />
    {/if}
  </main>

  <div class="toasts" role="status" aria-live="polite">
    {#each toasts.list as t (t.id)}
      <div class="toast" class:error={t.kind === 'error'}>
        <span>{t.message}</span>
        {#if t.action}
          {@const action = t.action}
          <button class="link" onclick={() => { action.run(); dismissToast(t.id); }}>{action.label}</button>
        {/if}
      </div>
    {/each}
  </div>

  <TabBar />
</div>
