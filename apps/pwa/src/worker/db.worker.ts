/// <reference lib="webworker" />
import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { ReaderlogDb, type DispatchEnv } from '@readerlog/db';
import { parseLocalDate, type Instant } from '@readerlog/core';
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

/**
 * Wait up to LOCK_TIMEOUT_MS for the DB (a tab being hidden hands it over quickly). Once that
 * timed out, later requests fail fast until visibility changes, so queued work doesn't stack
 * 5-second waits.
 */
let lastAttemptBusy = false;

function acquireLock(): Promise<void> {
  const waitForIt = !lastAttemptBusy;
  const options: LockOptions = waitForIt ? { signal: AbortSignal.timeout(LOCK_TIMEOUT_MS) } : { ifAvailable: true };
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

async function open(): Promise<ReaderlogDb> {
  if (db) return db;
  sqlite3 ??= await sqlite3InitModule();
  await acquireLock();
  try {
    if (pool) await pool.unpauseVfs();
    else pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'readerlog-sahpool' });
    const raw = new pool.OpfsSAHPoolDb(DB_FILE);
    // WAL without shared memory needs EXCLUSIVE locking, set before the first read; we hold the
    // DB exclusively anyway (Web Lock). WAL + synchronous=FULL keeps every commit durable while
    // writing far less than the rollback journal (research R12, measured 2–3× faster saves).
    raw.exec('PRAGMA locking_mode = EXCLUSIVE');
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA synchronous = FULL');
    const opened = new ReaderlogDb(raw);
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
    case 'stats': {
      const today = parseLocalDate(q.today);
      if (!today.ok) throw new Error(`bad today: ${today.error.reason}`);
      return d.stats(q.year, today.value);
    }
    case 'findByIsbn':
      return d.findByIsbn(q.isbn);
    case 'pendingDetails':
      return d.pendingDetails();
    case 'cover': {
      const c = d.getCover(q.itemId);
      return c ? new Blob([c.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }) : null;
    }
    case 'setting': {
      // Allow-list: the UI may read only this one meta key (it is a secret kept on this device).
      if (q.key !== 'google_books_api_key') throw new Error('setting not readable');
      return d.getMeta(q.key);
    }
    case 'storage': {
      const persisted = d.getMeta('storage_persisted');
      const info: StorageInfo = {
        persisted: persisted === null ? null : persisted === 'true',
        deviceId: d.getMeta('device_id') ?? '',
        schemaVersion: d.schemaVersion,
        covers: d.coverStats(),
      };
      return info;
    }
  }
}

const MIN_W = 40;
const MIN_H = 60;
const MAX_H = 480;

/** Decode, downscale to ≤480 px tall, re-encode as JPEG and cache. A cover is optional: any failure is `false`. */
async function storeCover(d: ReaderlogDb, itemId: string, image: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(image);
    try {
      if (bitmap.width < MIN_W || bitmap.height < MIN_H) return false;
      const scale = Math.min(1, MAX_H / bitmap.height);
      const width = Math.max(MIN_W, Math.round(bitmap.width * scale));
      const height = Math.min(MAX_H, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      ctx.drawImage(bitmap, 0, 0, width, height);
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
      d.putCover(itemId, new Uint8Array(await jpeg.arrayBuffer()), width, height, new Date().toISOString());
      channel.postMessage({ type: 'changed' });
      return true;
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
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
        if (req.cmd.kind === 'RemoveBook') d.deleteCover(req.cmd.itemId); // cache maintenance (R5)
        channel.postMessage({ type: 'changed' });
        return { id: req.id, ok: true, result: r.value };
      }
      case 'query':
        return { id: req.id, ok: true, result: runQuery(d, req.q) };
      case 'storeCover':
        return { id: req.id, ok: true, result: { stored: await storeCover(d, req.itemId, req.image) } };
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
    lastAttemptBusy = false;
    // Resume immediately (a queued request may be waiting for it); close in queue order.
    if (msg.visible) resumeWaiters.splice(0).forEach((r) => r());
    else queue = queue.then(close);
    return;
  }
  const next = queue.then(() => handle(msg));
  queue = next.catch(() => undefined);
  void next.then((res) => self.postMessage(res));
};
