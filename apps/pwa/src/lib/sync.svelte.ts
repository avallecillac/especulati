import type { SyncReason } from '@readerlog/sync';
import { onSyncOp, onWrite, sync } from './dbClient.ts';
import { fillMissingCovers } from './syncCovers.ts';

/** What the top bar needs: is sync on, and is a run in progress. Errors are US3's, not shown here. */
export const syncState = $state({ on: false, running: false });

const WRITE_DELAY_MS = 3000;
let inflight = 0;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

async function refreshStatus(): Promise<void> {
  const r = await sync({ action: 'status' });
  syncState.on = r.ok && r.value.on;
}

/** Run one sync. Never throws, never shows anything; the engine no-ops while sync is off. */
export async function runSync(reason: SyncReason): Promise<void> {
  if (!syncState.on) return;
  inflight++;
  syncState.running = true;
  try {
    const r = await sync({ action: 'run', reason });
    if (r.ok && r.value.changed) await fillMissingCovers();
  } finally {
    inflight--;
    syncState.running = inflight > 0;
  }
}

/** Call once the DB is ready: sends `start` and wires the visibility, online and write triggers. */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  await refreshStatus();

  onSyncOp((op, changed) => {
    if (op.action === 'turnOn' || op.action === 'join' || op.action === 'leave') {
      void refreshStatus();
      if (op.action === 'join' && changed) void fillMissingCovers();
    }
  });
  onWrite(() => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void runSync('write'), WRITE_DELAY_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSync('visible');
  });
  window.addEventListener('online', () => void runSync('online'));

  void runSync('start');
}
