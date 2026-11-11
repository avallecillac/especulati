<script lang="ts">
  import { QR_PREFIX } from '@especulati/cinefilo-db';
  import { formatSyncCode, parseQrPayload } from '@especulati/sync';
  import { createMember, setMe, startSpace, syncJoin, type CodeView } from '../lib/dbClient.ts';
  import { qrSvg } from '../lib/qr.ts';
  import { app, refresh } from '../lib/state.svelte.ts';
  import { GENERIC_FAILURE, syncErrorText } from '../lib/syncText.ts';
  import { navigate } from '../lib/router.svelte.ts';

  type Step = 'choose' | 'start' | 'code' | 'join' | 'who';

  // Joined but never picked who we are (the app was closed in between): go straight to "who am I".
  let step = $state<Step>(app.sync?.on ? 'who' : 'choose');
  let name = $state('');
  let pasted = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let shown = $state<{ code: string; svg: string } | null>(null);

  async function reveal(c: CodeView) {
    shown = { code: c.code, svg: await qrSvg(c.qr) };
  }

  async function start() {
    busy = true;
    error = null;
    app.onboarding = true;
    const r = await startSpace(name);
    busy = false;
    if (!r.ok) {
      app.onboarding = false;
      error = r.error.kind === 'Busy' || r.error.kind === 'Storage' ? GENERIC_FAILURE : 'Please enter your name.';
      return;
    }
    if (r.value.sync.ok) {
      await reveal(r.value.sync.value);
      step = 'code';
    } else {
      // The list works without the network; sharing can be turned on later from Settings.
      await finish();
    }
  }

  async function finish() {
    app.onboarding = false;
    await refresh();
    navigate('/later');
  }

  async function join() {
    error = null;
    const text = pasted.trim();
    const fromQr = parseQrPayload(text, QR_PREFIX);
    const code = fromQr.ok ? formatSyncCode(fromQr.value) : text;
    busy = true;
    app.onboarding = true;
    const r = await syncJoin(code);
    busy = false;
    if (!r.ok) {
      app.onboarding = false;
      error = GENERIC_FAILURE;
      return;
    }
    if (!r.value.ok) {
      app.onboarding = false;
      error = syncErrorText(r.value.error.kind as Parameters<typeof syncErrorText>[0]);
      return;
    }
    await refresh();
    app.onboarding = true;
    step = 'who';
  }

  async function pick(id: string) {
    const r = await setMe(id);
    if (!r.ok) return void (error = GENERIC_FAILURE);
    await finish();
  }

  async function imNew() {
    error = null;
    const r = await createMember(name);
    if (!r.ok) return void (error = 'Please enter your name.');
    await finish();
  }
</script>

<main class="welcome">
  <h1>Cinéfilo</h1>

  {#if step === 'choose'}
    <p class="lead">What to watch, and what you both thought of it.</p>
    <button class="primary" type="button" onclick={() => { error = null; step = 'start'; }}>Start a shared list</button>
    <button type="button" onclick={() => { error = null; step = 'join'; }}>Join with a code</button>
  {:else if step === 'start'}
    <form onsubmit={(e) => { e.preventDefault(); void start(); }}>
      <label for="my-name">Your name</label>
      <input id="my-name" autocomplete="off" bind:value={name} />
      <button class="primary" type="submit" disabled={busy}>Create the list</button>
      <button type="button" onclick={() => (step = 'choose')}>Back</button>
    </form>
  {:else if step === 'code'}
    <p class="lead">Your list is ready. Share this code with your partner so they can join.</p>
    {#if shown}
      <div class="qr" role="img" aria-label="Sync code QR">{@html shown.svg}</div>
      <p><code data-testid="sync-code">{shown.code}</code></p>
    {/if}
    <p class="muted">Anyone with this code can read and edit the list. You can show it again from Settings.</p>
    <button class="primary" type="button" onclick={finish}>Continue</button>
  {:else if step === 'join'}
    <form onsubmit={(e) => { e.preventDefault(); void join(); }}>
      <label for="join-code">Sync code</label>
      <textarea id="join-code" rows="3" autocomplete="off" autocapitalize="characters" spellcheck="false" bind:value={pasted}></textarea>
      <button class="primary" type="submit" disabled={busy || pasted.trim() === ''}>Join</button>
      <button type="button" onclick={() => (step = 'choose')}>Back</button>
    </form>
  {:else}
    <h2>Who are you?</h2>
    {#each app.members as m (m.id)}
      <button type="button" onclick={() => void pick(m.id)}>I'm {m.name}</button>
    {/each}
    <form onsubmit={(e) => { e.preventDefault(); void imNew(); }}>
      <label for="new-name">I'm new</label>
      <input id="new-name" placeholder="Your name" autocomplete="off" bind:value={name} />
      <button class="primary" type="submit">Create me</button>
    </form>
  {/if}

  <p role="alert" class="error">{error ?? ''}</p>
</main>
