<script lang="ts">
  import Fleuron from './Fleuron.svelte';
  /** A hairline rule with a centred fleuron, used between major sections. Decorative. */
</script>

<div class="rule" aria-hidden="true"><span></span><Fleuron size={14} /><span></span></div>

<style>
  .rule { display: flex; align-items: center; gap: 10px; margin: 24px 8px; }
  .rule span { flex: 1; height: 0; border-top: 0.5px solid var(--rule); }
</style>
