<script lang="ts">
  let { title, body = '', confirmLabel, danger = false, onconfirm, oncancel }: {
    title: string;
    body?: string;
    confirmLabel: string;
    danger?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && oncancel()} />

<div class="sheet-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && oncancel()}>
  <div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <h1 id="confirm-title">{title}</h1>
    {#if body}<p class="muted">{body}</p>{/if}
    <div class="actions">
      <button class={danger ? 'danger' : 'primary'} onclick={onconfirm}>{confirmLabel}</button>
      <button onclick={oncancel}>Cancel</button>
    </div>
  </div>
</div>
