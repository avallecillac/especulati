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

/** Undo for a write that made several entries: removes them in the given order (abandoned first, then progress). */
export function toastSavedMany(message: string, itemId: string, eventIds: readonly string[]): void {
  const run = async () => {
    for (const eventId of eventIds) {
      const r = await dispatch({ kind: 'RemoveEvent', itemId, eventId });
      if (!r.ok) return void showToast(errorMessage(r.error), { kind: 'error' });
    }
    showToast('Entry removed');
  };
  showToast(message, { action: { label: 'Undo', run: () => void run() } });
}
