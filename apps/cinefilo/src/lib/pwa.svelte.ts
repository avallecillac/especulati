import { registerSW } from 'virtual:pwa-register';

/**
 * Service-worker updates. registerType 'prompt': a new version waits until the member taps
 * Update, so nothing reloads mid-edit. Tabs stay open for days on phones, so also look for a
 * new version whenever the app comes back to the foreground, and hourly while it is open.
 */
export const pwa = $state({ needRefresh: false });

const HOUR = 60 * 60 * 1000;

const updateSW = registerSW({
  onNeedRefresh() {
    pwa.needRefresh = true;
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, HOUR);
  },
});

/** Activate the waiting version and reload into it. */
export function applyUpdate(): void {
  void updateSW(true);
}
