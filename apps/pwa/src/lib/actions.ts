import { dispatch } from './dbClient.ts';
import { errorMessage } from './errors.ts';
import { showToast } from './toast.svelte.ts';

/** Undo = tombstone the entry just created (US4). */
export async function undoEvent(itemId: string, eventId: string): Promise<void> {
  const r = await dispatch({ kind: 'RemoveEvent', itemId, eventId });
  showToast(r.ok ? 'Entry removed' : errorMessage(r.error), { kind: r.ok ? 'info' : 'error' });
}

export function toastSaved(message: string, itemId: string, eventId: string): void {
  showToast(message, { action: { label: 'Undo', run: () => void undoEvent(itemId, eventId) } });
}
