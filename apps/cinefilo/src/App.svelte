<script lang="ts">
  const tabs = ['Watch later', 'Watching', 'Watched', 'Settings'] as const;
  let active = $state<(typeof tabs)[number]>('Watch later');
</script>

<main>
  <h1>Cinéfilo</h1>
  <p>{active}</p>
</main>
<nav>
  {#each tabs as tab (tab)}
    <button type="button" aria-current={active === tab ? 'page' : undefined} onclick={() => (active = tab)}>{tab}</button>
  {/each}
</nav>
