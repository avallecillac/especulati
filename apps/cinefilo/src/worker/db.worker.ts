/// <reference lib="webworker" />
import sqlite3InitModule, { type OpfsSAHPoolDatabase, type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { DB_FILE, LOCK, SAH_POOL_NAME } from './frozen.ts';
import type { ClientError, Control, Request, Response } from '../lib/protocol.ts';

/**
 * Owns the on-device database. Same scheme as lector's worker (a copy, not shared: lector's frozen
 * worker stays untouched): opfs-sahpool allows one connection, so tabs take turns through the Web
 * Lock; a hidden tab closes the DB, pauses the VFS and releases the lock.
 */
const LOCK_TIMEOUT_MS = 5000;

let sqlite3: Sqlite3Static | null = null;
let pool: SAHPoolUtil | null = null;
let db: OpfsSAHPoolDatabase | null = null;
let releaseLock: (() => void) | null = null;
let wantOpen = true;
const resumeWaiters: (() => void)[] = [];
let queue: Promise<unknown> = Promise.resolve();
let lastAttemptBusy = false;

class BusyError extends Error {}

function acquireLock(): Promise<void> {
  const options: LockOptions = lastAttemptBusy ? { ifAvailable: true } : { signal: AbortSignal.timeout(LOCK_TIMEOUT_MS) };
  return new Promise<void>((acquired, rejected) => {
    navigator.locks
      .request(LOCK, options, (lock) => {
        if (!lock) {
          rejected(new BusyError());
          return;
        }
        lastAttemptBusy = false;
        acquired();
        return new Promise<void>((release) => (releaseLock = release));
      })
      .catch((e: unknown) => {
        const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
        if (timedOut) lastAttemptBusy = true;
        rejected(timedOut ? new BusyError() : e instanceof Error ? e : new Error(String(e)));
      });
  });
}

async function open(): Promise<OpfsSAHPoolDatabase> {
  if (db) return db;
  sqlite3 ??= await sqlite3InitModule();
  await acquireLock();
  try {
    if (pool) await pool.unpauseVfs();
    else pool = await sqlite3.installOpfsSAHPoolVfs({ name: SAH_POOL_NAME });
    const raw = new pool.OpfsSAHPoolDb(DB_FILE);
    // WAL without shared memory needs EXCLUSIVE locking, set before the first read.
    raw.exec('PRAGMA locking_mode = EXCLUSIVE');
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA synchronous = FULL');
    db = raw;
    return raw;
  } catch (e) {
    releaseLock?.();
    releaseLock = null;
    throw e;
  }
}

function close(): void {
  if (!db) return;
  db.close();
  db = null;
  pool?.pauseVfs();
  releaseLock?.();
  releaseLock = null;
}

function toClientError(e: unknown): ClientError {
  if (e instanceof BusyError) return { kind: 'Busy' };
  return { kind: 'Storage', message: e instanceof Error ? e.message : String(e) };
}

async function handle(req: Request): Promise<Response> {
  try {
    while (!wantOpen) await new Promise<void>((r) => resumeWaiters.push(r));
    await open();
    return { id: req.id, ok: true, result: null };
  } catch (e) {
    return { id: req.id, ok: false, error: toClientError(e) };
  }
}

self.onmessage = (ev: MessageEvent<Request | Control>) => {
  const msg = ev.data;
  if (msg.kind === 'visibility') {
    wantOpen = msg.visible;
    lastAttemptBusy = false;
    if (msg.visible) resumeWaiters.splice(0).forEach((r) => r());
    else queue = queue.then(close);
    return;
  }
  const next = queue.then(() => handle(msg));
  queue = next.catch(() => undefined);
  void next.then((res) => self.postMessage(res));
};
