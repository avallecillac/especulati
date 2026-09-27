/// <reference lib="webworker" />
import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { ReaderlogDb, type DispatchEnv } from '@readerlog/db';
import type { Instant } from '@readerlog/core';
import { CHANNEL, type ClientError, type Control, type Query, type Request, type Response, type StorageInfo } from '../lib/protocol.ts';

/**
 * Owns the on-device database (research R1/R2). opfs-sahpool allows one connection at a
 * time, so tabs take turns: the visible tab holds the Web Lock; a hidden tab closes the DB,
 * pauses the VFS and releases the lock. Requests wait until this tab owns the DB again.
 */
const LOCK = 'readerlog-db';
const DB_FILE = '/readerlog.db';
const LOCK_TIMEOUT_MS = 5000;

const channel = new BroadcastChannel(CHANNEL);
let sqlite3: Sqlite3Static | null = null;
let pool: SAHPoolUtil | null = null;
let db: ReaderlogDb | null = null;
let releaseLock: (() => void) | null = null;
let wantOpen = true;
const resumeWaiters: (() => void)[] = [];
/** Serialises open/close transitions and all requests. */
let queue: Promise<unknown> = Promise.resolve();

class BusyError extends Error {}

function acquireLock(): Promise<void> {
  return new Promise<void>((acquired, rejected) => {
    navigator.locks
      .request(LOCK, { signal: AbortSignal.timeout(LOCK_TIMEOUT_MS) }, () => {
        acquired();
        return new Promise<void>((release) => (releaseLock = release));
      })
      .catch((e: unknown) =>
        rejected(
          e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError') ? new BusyError()
          : e instanceof Error ? e
          : new Error(String(e)),
        ),
      );
  });
}

async function open(): Promise<ReaderlogDb> {
  if (db) return db;
  sqlite3 ??= await sqlite3InitModule();
  await acquireLock();
  try {
    if (pool) await pool.unpauseVfs();
    else pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'readerlog-sahpool' });
    const opened = new ReaderlogDb(new pool.OpfsSAHPoolDb(DB_FILE));
    opened.migrate();
    opened.ensureDeviceId(crypto.randomUUID());
    db = opened;
    return opened;
  } catch (e) {
    releaseLock?.();
    releaseLock = null;
    throw e;
  }
}

function close(): void {
  if (!db) return;
  db.raw.close();
  db = null;
  pool?.pauseVfs();
  releaseLock?.();
  releaseLock = null;
}

function env(): DispatchEnv {
  return {
    now: new Date().toISOString() as Instant,
    wallMs: () => Date.now(),
    newOpId: () => crypto.randomUUID(),
  };
}

function runQuery(d: ReaderlogDb, q: Query): unknown {
  switch (q.name) {
    case 'home':
      return d.home();
    case 'library':
      return d.library();
    case 'book':
      return d.book(q.itemId);
    case 'storage': {
      const persisted = d.getMeta('storage_persisted');
      const info: StorageInfo = {
        persisted: persisted === null ? null : persisted === 'true',
        deviceId: d.getMeta('device_id') ?? '',
        schemaVersion: d.schemaVersion,
      };
      return info;
    }
  }
}

function toClientError(e: unknown): ClientError {
  if (e instanceof BusyError) return { kind: 'Busy' };
  const message = e instanceof Error ? e.message : String(e);
  return { kind: 'Storage', message };
}

async function handle(req: Request): Promise<Response> {
  try {
    while (!wantOpen) await new Promise<void>((r) => resumeWaiters.push(r));
    const d = await open();
    switch (req.kind) {
      case 'dispatch': {
        const r = d.dispatch(req.cmd, env());
        if (!r.ok) return { id: req.id, ok: false, error: r.error };
        channel.postMessage({ type: 'changed' });
        return { id: req.id, ok: true, result: r.value };
      }
      case 'query':
        return { id: req.id, ok: true, result: runQuery(d, req.q) };
      case 'setMeta':
        d.setMeta(req.key, req.value);
        return { id: req.id, ok: true, result: null };
    }
  } catch (e) {
    return { id: req.id, ok: false, error: toClientError(e) };
  }
}

self.onmessage = (ev: MessageEvent<Request | Control>) => {
  const msg = ev.data;
  if (msg.kind === 'visibility') {
    wantOpen = msg.visible;
    // Resume immediately (a queued request may be waiting for it); close in queue order.
    if (msg.visible) resumeWaiters.splice(0).forEach((r) => r());
    else queue = queue.then(close);
    return;
  }
  const next = queue.then(() => handle(msg));
  queue = next.catch(() => undefined);
  void next.then((res) => self.postMessage(res));
};
