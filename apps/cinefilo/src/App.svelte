<script lang="ts">
  import { app, startApp } from './lib/state.svelte.ts';
  import { router } from './lib/router.svelte.ts';
  import Welcome from './screens/Welcome.svelte';
  import List from './screens/List.svelte';
  import TitleScreen from './screens/TitleScreen.svelte';
  import Settings from './screens/Settings.svelte';
  import AddSheet from './screens/AddSheet.svelte';

  const TABS = [
    { label: 'Watch later', href: '#/later', tab: 'later' },
    { label: 'Watching', href: '#/watching', tab: 'watching' },
    { label: 'Watched', href: '#/watched', tab: 'watched' },
    { label: 'Settings', href: '#/settings', tab: 'settings' },
  ] as const;

  let adding = $state(false);

  startApp();

  const route = $derived(router.route);
  const current = $derived(route.name === 'list' ? route.tab : route.name === 'settings' ? 'settings' : null);
</script>

{#if app.ready}
  <span data-testid="ready" hidden></span>
{/if}

{#if !app.ready}
  <main class="center"><p class="muted">Loading</p></main>
{:else if app.memberId === null || app.onboarding}
  <Welcome />
{:else}
  <main>
    {#if route.name === 'list'}
      {#key route.tab}
        <List tab={route.tab} onadd={() => (adding = true)} />
      {/key}
    {:else if route.name === 'title'}
      {#key route.id}
        <TitleScreen id={route.id} />
      {/key}
    {:else}
      <Settings />
    {/if}
  </main>

  {#if app.toast}
    {@const toast = app.toast}
    <div class="toast" role="status">
      <span>{toast.text}</span>
      {#if toast.undo}
        <button
          type="button"
          class="link"
          onclick={() => {
            const undo = toast.undo;
            app.toast = null;
            undo?.();
          }}>Undo</button>
      {/if}
    </div>
  {/if}

  <nav class="tabbar" aria-label="Sections">
    {#each TABS as t (t.tab)}
      <a href={t.href} aria-current={current === t.tab ? 'page' : undefined}>{t.label}</a>
    {/each}
  </nav>

  {#if adding}
    <AddSheet onclose={() => (adding = false)} />
  {/if}
{/if}
