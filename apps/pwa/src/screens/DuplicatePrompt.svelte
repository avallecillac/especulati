<script lang="ts">
  import type { BookCard } from '@readerlog/db';
  import { navigate } from '../lib/router.svelte.ts';
  import Confirm from './Confirm.svelte';

  let { existing, onaddcopy, oncancel }: {
    existing: BookCard;
    onaddcopy: () => void;
    oncancel: () => void;
  } = $props();
</script>

<Confirm
  title="Already in your library"
  body={`“${existing.title}” is already in your library.`}
  confirmLabel="Open existing"
  secondaryLabel="Add another copy"
  onconfirm={() => navigate(`/book/${existing.itemId}`)}
  onsecondary={onaddcopy}
  {oncancel}
/>
