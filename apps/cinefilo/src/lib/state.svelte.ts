import type { MemberView } from '@especulati/cinefilo-db';
import type { SyncStatusView } from '@especulati/sync';
import { CHANNEL } from '../worker/frozen.ts';
import { dispatch, me, members, syncRun, syncStatus, type Call } from './dbClient.ts';
import type { UiCommand } from './commands.ts';
import { loadTmdbKey } from './tmdb.svelte.ts';

/**
 * Shared UI state. `rev` bumps after every write (ours, another tab's, or a sync that pulled), and the
 * screens reload their data from it. Everything here is plain data copied out of the worker's replies.
 */
export const app = $state<{
  ready: boolean;
  /** True from "Start a list" or "Join" until the person finishes first-run: the code step must outlive the identity being set. */
  onboarding: boolean;
  memberId: string | null;
  members: MemberView[];
  sync: SyncStatusView | null;
  syncing: boolean;
  rev: number;
  toast: { text: string; undo?: () => void } | null;
}>({ ready: false, onboarding: false, memberId: null, members: [], sync: null, syncing: false, rev: 0, toast: null });

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, undo?: () => void): void {
  clearTimeout(toastTimer);
  app.toast = undo ? { text, undo } : { text };
  toastTimer = setTimeout(() => (app.toast = null), 7000);
}

export async function refresh(): Promise<void> {
  const [m, who, st] = await Promise.all([members(), me(), syncStatus(), loadTmdbKey()]);
  if (m.ok) app.members = m.value;
  if (who.ok) app.memberId = who.value.memberId;
  if (st.ok) app.sync = st.value;
  app.ready = true;
  app.rev++;
}

export async function runSync(reason: Parameters<typeof syncRun>[0]): Promise<void> {
  if (!app.sync?.on || app.syncing) return;
  app.syncing = true;
  try {
    await syncRun(reason);
  } finally {
    app.syncing = false;
    await refresh();
  }
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;

/** Send one command; refresh the screens; push to the partner soon after. */
export async function write(cmd: UiCommand): Promise<Call<{ changes: number }>> {
  const r = await dispatch(cmd);
  if (r.ok) {
    app.rev++;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void runSync('write'), 1500);
  }
  return r;
}

let started = false;

export function startApp(): void {
  if (started) return;
  started = true;
  new BroadcastChannel(CHANNEL).onmessage = () => void refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSync('visible');
  });
  window.addEventListener('online', () => void runSync('online'));
  void refresh().then(() => runSync('start'));
}
