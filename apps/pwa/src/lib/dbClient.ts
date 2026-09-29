import type { Command, Result } from '@readerlog/core';
import type { DispatchOutcome } from '@readerlog/db';
import { CHANNEL, type ClientError, type Control, type Query, type QueryResult, type Request, type Response, type SyncOp, type SyncResult } from './protocol.ts';

type Pending = (res: Response) => void;

const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
const listeners = new Set<() => void>();
let seq = 0;

// A tab that starts hidden must not grab the DB from the visible one.
worker.postMessage({ kind: 'visibility', visible: document.visibilityState === 'visible' } satisfies Control);

worker.onmessage = (ev: MessageEvent<Response>) => {
  const cb = pending.get(ev.data.id);
  pending.delete(ev.data.id);
  cb?.(ev.data);
};

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

function send(req: WithoutId<Request>): Promise<Response> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

const writeHooks = new Set<() => void>();
const syncHooks = new Set<(op: SyncOp, changed: boolean) => void>();

const notify = () => listeners.forEach((l) => l());

// Other tabs' commits arrive over the channel; refresh when this tab is visible again.
new BroadcastChannel(CHANNEL).onmessage = () => {
  if (document.visibilityState === 'visible') notify();
  else staleWhileHidden = true;
};
let staleWhileHidden = false;

document.addEventListener('visibilitychange', () => {
  const visible = document.visibilityState === 'visible';
  worker.postMessage({ kind: 'visibility', visible } satisfies Control);
  if (visible && staleWhileHidden) {
    staleWhileHidden = false;
    notify();
  }
});

export async function dispatch(cmd: Command): Promise<Result<DispatchOutcome, ClientError>> {
  const res = await send({ kind: 'dispatch', cmd });
  if (res.ok) {
    notify();
    writeHooks.forEach((h) => h());
    return { ok: true, value: res.result as DispatchOutcome };
  }
  return { ok: false, error: res.error };
}

export async function query<N extends Query['name']>(
  q: Extract<Query, { name: N }>,
): Promise<Result<QueryResult[N], ClientError>> {
  const res = await send({ kind: 'query', q });
  return res.ok ? { ok: true, value: res.result as QueryResult[N] } : { ok: false, error: res.error };
}

/** Downscale and cache a cover in the worker. `stored: false` means it was unusable; never an error. */
export async function storeCover(itemId: string, image: Blob): Promise<{ stored: boolean }> {
  const res = await send({ kind: 'storeCover', itemId, image });
  if (res.ok) {
    const out = res.result as { stored: boolean };
    if (out.stored) notify();
    return out;
  }
  return { stored: false };
}

export async function setMeta(key: string, value: string): Promise<void> {
  await send({ kind: 'setMeta', key, value });
}

/** Run a sync action in the DB worker. Engine errors (typo, not found, offline) are inside the value. */
export async function sync<A extends SyncOp['action']>(
  op: Extract<SyncOp, { action: A }>,
): Promise<Result<SyncResult[A], ClientError>> {
  const res = await send({ kind: 'sync', op });
  if (!res.ok) return { ok: false, error: res.error };
  const value = res.result as SyncResult[A];
  // Applied remote ops (a run that pulled, or a join) change what every screen shows.
  const changed =
    op.action === 'join' || op.action === 'turnOn' || (op.action === 'run' && (value as SyncResult['run']).changed);
  if (changed) notify();
  syncHooks.forEach((h) => h(op, changed));
  return { ok: true, value };
}

/** Called after every successful dispatch (sync's debounced `write` trigger). Returns an unsubscribe fn. */
export function onWrite(cb: () => void): () => void {
  writeHooks.add(cb);
  return () => writeHooks.delete(cb);
}

/** Called after every sync op that reached the worker. `changed`: remote ops were applied. */
export function onSyncOp(cb: (op: SyncOp, changed: boolean) => void): () => void {
  syncHooks.add(cb);
  return () => syncHooks.delete(cb);
}

/** Ask every screen to reload, e.g. after regaining the DB from another window. */
export const refreshAll = (): void => notify();

/** Subscribe to "data changed" (own dispatches and other tabs). Returns an unsubscribe fn. */
export function onChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
