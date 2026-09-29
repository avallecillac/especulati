import type { SyncReason, SyncStatusView } from '@readerlog/sync';
import { dispatch, onSyncOp, onWrite, query, sync } from './dbClient.ts';
import { mergeCopyId } from './ids.ts';
import { fillMissingCovers } from './syncCovers.ts';

/** Is sync on, is a run in progress, and the last status the worker reported (Settings shows it). */
export const syncState = $state<{ on: boolean; running: boolean; status: SyncStatusView | null }>({ on: false, running: false, status: null });

const WRITE_DELAY_MS = 3000;
let inflight = 0;
let writeTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

export async function refreshStatus(): Promise<void> {
  const r = await sync({ action: 'status' });
  syncState.on = r.ok && r.value.on;
  syncState.status = r.ok ? r.value : null;
}

/**
 * After a run that applied remote changes: move entries logged on a book that was merged away
 * (on another device) onto the book it ended up in (research R8, FR-029). Ids are content-addressed,
 * so two devices sweeping the same entry write the same row.
 */
export async function sweepStragglers(): Promise<void> {
  const found = await query({ name: 'stragglers' });
  if (!found.ok) return;
  for (const s of found.value) {
    const copies = await Promise.all(
      s.events.map(async (e) => ({ from: e.id, to: await mergeCopyId(s.survivorId, e) })),
    );
    await dispatch({ kind: 'MergeBooks', survivorId: s.survivorId, duplicateId: s.duplicateId, copies });
  }
}

/** Run one sync. Never throws, never shows anything; the engine no-ops while sync is off. */
export async function runSync(reason: SyncReason): Promise<void> {
  if (!syncState.on) return;
  inflight++;
  syncState.running = true;
  try {
    const r = await sync({ action: 'run', reason });
    if (r.ok && r.value.changed) {
      await sweepStragglers();
      await fillMissingCovers();
    }
  } finally {
    inflight--;
    syncState.running = inflight > 0;
    await refreshStatus();
  }
}

/** Call once the DB is ready: sends `start` and wires the visibility, online and write triggers. */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  await refreshStatus();

  onSyncOp((op, changed) => {
    if (op.action === 'turnOn' || op.action === 'join' || op.action === 'leave' || op.action === 'reset') {
      void refreshStatus();
      if (op.action === 'join' && changed) void fillMissingCovers();
    }
  });
  onWrite(() => {
    void refreshStatus();
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => void runSync('write'), WRITE_DELAY_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSync('visible');
  });
  window.addEventListener('online', () => void runSync('online'));

  void runSync('start');
}
