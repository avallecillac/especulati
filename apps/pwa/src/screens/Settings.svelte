<script lang="ts">
  import type { StorageInfo } from '../lib/protocol.ts';
  import { onChanged, query } from '../lib/dbClient.ts';

  let info = $state<StorageInfo | null>(null);

  async function load() {
    const r = await query({ name: 'storage' });
    if (r.ok) info = r.value;
  }

  $effect(() => {
    void load();
    return onChanged(() => void load());
  });
</script>

<h1>Settings</h1>

{#if info}
  <section class="card">
    {#if info.persisted}
      <p><strong>Storage: persistent.</strong> Your browser won't clear Readerlog's data to free space.</p>
    {:else}
      <p><strong>Storage: not persistent.</strong></p>
      <p class="muted">
        The browser may clear data under storage pressure. On iPhone, add Readerlog to your Home Screen
        (Share → Add to Home Screen) and open it from there. Export and sync are coming in later versions.
      </p>
    {/if}
  </section>

  <section class="card">
    <p class="muted">Device</p>
    <p><code data-testid="device-id">{info.deviceId}</code></p>
    <p class="muted">Schema version {info.schemaVersion}</p>
    <p class="muted" data-testid="cover-stats">Covers stored: {info.covers.count} ({Math.round(info.covers.bytes / 1024)} KB)</p>
  </section>
{/if}
