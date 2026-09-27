import { registerSW } from 'virtual:pwa-register';
import { setMeta } from './dbClient.ts';

/** Service-worker update state. registerType 'prompt': we never reload mid-log (research R4). */
export const pwa = $state({ needRefresh: false });

const updateSW = registerSW({
  onNeedRefresh() {
    pwa.needRefresh = true;
  },
});

export function applyUpdate(): void {
  void updateSW(true);
}

/** FR-013: ask the browser to keep our storage, and remember the answer for Settings. */
export async function requestPersistentStorage(): Promise<void> {
  if (!navigator.storage?.persist) return;
  const granted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  await setMeta('storage_persisted', String(granted));
}
