import { dispatch } from './dbClient.ts';
import { todayLocal } from './clock.ts';
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

/** Undo = a saved article was marked read, so mark it unread again (008). */
async function undoMarkRead(itemId: string): Promise<void> {
  const r = await dispatch({ kind: 'MarkArticleUnread', itemId });
  showToast(r.ok ? 'Back in Saved' : errorMessage(r.error), { kind: r.ok ? 'info' : 'error' });
}

/** Mark a saved article read today, with a toast whose Undo puts it back in Saved. Returns whether it worked. */
export async function markArticleRead(itemId: string): Promise<boolean> {
  const r = await dispatch({ kind: 'MarkArticleRead', itemId, readOn: todayLocal() });
  if (!r.ok) {
    showToast(errorMessage(r.error), { kind: 'error' });
    return false;
  }
  showToast('Marked as read', { action: { label: 'Undo', run: () => void undoMarkRead(itemId) } });
  return true;
}

/** Remove a saved or read article, with a toast whose Undo restores it (RestoreArticle). */
export async function removeArticle(itemId: string, message: string): Promise<boolean> {
  const r = await dispatch({ kind: 'RemoveArticle', itemId });
  if (!r.ok) {
    showToast(errorMessage(r.error), { kind: 'error' });
    return false;
  }
  const undo = async () => {
    const u = await dispatch({ kind: 'RestoreArticle', itemId });
    if (!u.ok) showToast(errorMessage(u.error), { kind: 'error' });
  };
  showToast(message, { action: { label: 'Undo', run: () => void undo() } });
  return true;
}
