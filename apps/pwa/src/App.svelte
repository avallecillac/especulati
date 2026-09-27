<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { query } from './lib/dbClient.ts';
  import { dismissToast, toasts } from './lib/toast.svelte.ts';
  import Home from './screens/Home.svelte';
  import AddBook from './screens/AddBook.svelte';
  import Library from './screens/Library.svelte';
  import BookDetail from './screens/BookDetail.svelte';
  import Settings from './screens/Settings.svelte';

  const tabs = [
    { href: '#/', label: 'Home', match: 'home' },
    { href: '#/library', label: 'Library', match: 'library' },
    { href: '#/add', label: 'Add', match: 'add' },
    { href: '#/settings', label: 'Settings', match: 'settings' },
  ] as const;

  // Signals (to users of assistive tech and to tests) that the on-device DB is open.
  let dbReady = $state(false);
  void query({ name: 'storage' }).then((r) => (dbReady = r.ok));
</script>

<div class="app">
  {#if dbReady}<div data-testid="ready" hidden></div>{/if}
  <header class="bar"><a class="brand" href="#/">Readerlog</a></header>

  <main>
    {#if router.route.name === 'home'}
      <Home />
    {:else if router.route.name === 'add'}
      <AddBook />
    {:else if router.route.name === 'edit'}
      {#key router.route.id}<AddBook editId={router.route.id} />{/key}
    {:else if router.route.name === 'library'}
      <Library />
    {:else if router.route.name === 'book'}
      {#key router.route.id}<BookDetail id={router.route.id} />{/key}
    {:else if router.route.name === 'settings'}
      <Settings />
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
      <a href={tab.href} aria-current={router.route.name === tab.match ? 'page' : undefined}>{tab.label}</a>
    {/each}
  </nav>
</div>
