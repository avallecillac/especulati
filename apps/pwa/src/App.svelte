<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { query, refreshAll } from './lib/dbClient.ts';
  import { loadSettings } from './lib/settings.svelte.ts';
  import { runDetailsRetry } from './lib/detailsRetry.ts';
  import { runSync, startSync, syncState } from './lib/sync.svelte.ts';
  import { applyUpdate, pwa } from './lib/pwa.svelte.ts';
  import { dismissToast, toasts } from './lib/toast.svelte.ts';
  import Home from './screens/Home.svelte';
  import AddBook from './screens/AddBook.svelte';
  import Scan from './screens/Scan.svelte';
  import Search from './screens/Search.svelte';
  import EnterIsbn from './screens/EnterIsbn.svelte';
  import Library from './screens/Library.svelte';
  import BookDetail from './screens/BookDetail.svelte';
  import Stats from './screens/Stats.svelte';
  import Settings from './screens/Settings.svelte';
  import Sync from './screens/Sync.svelte';

  const tabs = [
    { href: '#/', label: 'Home', match: 'home' },
    { href: '#/library', label: 'Library', match: 'library' },
    { href: '#/add', label: 'Add', match: 'add' },
    { href: '#/stats', label: 'Stats', match: 'stats' },
    { href: '#/settings', label: 'Settings', match: 'settings' },
  ] as const;

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
  <header class="bar"><a class="brand" href="#/">Readerlog</a>
    {#if syncState.on}
      <button class="sync-btn" class:spinning={syncState.running} type="button" aria-label="Sync now" disabled={syncState.running} onclick={() => void runSync('manual')}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18 2v4h-4M6 22v-4h4" /></svg>
      </button>
    {/if}
  </header>

  {#if busy}
    <div class="update" role="alert">Readerlog is open in another window. Close it or switch to it.</div>
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
    {:else if router.route.name === 'stats'}
      <Stats />
    {:else if router.route.name === 'settings'}
      <Settings />
    {:else if router.route.name === 'sync'}
      <Sync />
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

  <nav class="tabs" aria-label="Main">
    {#each tabs as tab (tab.href)}
      <a href={tab.href} aria-current={router.route.name === tab.match || (tab.match === 'settings' && router.route.name === 'sync') ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>
</div>
