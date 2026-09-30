<script lang="ts">
  import { router } from '../lib/router.svelte.ts';
  import TabIcon from '../ornaments/TabIcon.svelte';

  const tabs = [
    { href: '#/', label: 'Home', match: 'home', icon: 'home' },
    { href: '#/library', label: 'Library', match: 'library', icon: 'library' },
    { href: '#/add', label: 'Add', match: 'add', icon: 'add' },
    { href: '#/stats', label: 'Stats', match: 'stats', icon: 'stats' },
    { href: '#/settings', label: 'Settings', match: 'settings', icon: 'settings' },
  ] as const;

  const current = (match: string): boolean => {
    const n = router.route.name;
    return n === match || (match === 'library' && (n === 'articles' || n === 'article')) || (match === 'settings' && (n === 'sync' || n === 'duplicates'));
  };
</script>

<nav class="tabs" aria-label="Main">
  {#each tabs as tab (tab.href)}
    <a href={tab.href} aria-current={current(tab.match) ? 'page' : undefined}><TabIcon name={tab.icon} /><span>{tab.label}</span></a>
  {/each}
</nav>
