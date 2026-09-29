import type { SyncProblem } from '@readerlog/db';
import type { SyncStatusView } from '@readerlog/sync';
import { plural } from './format.ts';

/** Plain-language text for each problem (US3, T020). */
export const PROBLEM_TEXT: Record<SyncProblem, string> = {
  offline: 'Offline — changes will be sent later',
  relay: "Can't reach the sync service — will retry",
  spaceGone: 'This sync space no longer exists. Rejoin with a new code.',
  unauthorized: 'This sync space no longer exists. Rejoin with a new code.',
  newerVersion: 'Another device uses a newer Readerlog — update this one',
  corrupt: "Some changes couldn't be read and were skipped",
};

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function relativeTime(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${plural(Math.floor(h / 24), 'day')} ago`;
}

export const pendingText = (n: number): string => `${plural(n, 'change')} waiting to sync`;

/** Changes that were skipped or are stuck waiting for data that never arrived. */
export const unreadable = (s: SyncStatusView): number => s.undecryptable + s.inboxStuck;

export const unreadableText = (n: number): string => `${plural(n, 'change')} couldn't be read and ${n === 1 ? 'was' : 'were'} skipped`;

/** The problem line for `s`, or null when all is well. */
export function problemLine(s: SyncStatusView): string | null {
  if (s.problem) return PROBLEM_TEXT[s.problem];
  const n = unreadable(s);
  return n > 0 ? unreadableText(n) : null;
}

/** The single line on the main Settings screen. */
export function summaryLine(s: SyncStatusView, nowMs: number): string {
  if (!s.on) return 'Sync is off';
  const problem = problemLine(s);
  if (problem) return problem;
  const last = s.lastOkAt ? `Last synced: ${relativeTime(s.lastOkAt, nowMs)}` : 'Not synced yet';
  return `${last} · ${pendingText(s.pending)}`;
}
