/// <reference lib="webworker" />
import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { ReaderlogDb, type DispatchEnv, type DispatchOutcome } from '@readerlog/db';
import { err, ok, parseLocalDate, tagKey, type Command, type Instant, type Rejection, type Result } from '@readerlog/core';
import { createSyncEngine, type SyncEngine } from '@readerlog/sync';
import { itemTagId, reconcileAll } from '../lib/reconcile.ts';
import { uuidFromHash } from '../lib/ids.ts';
import { CHANNEL, type ClientError, type Control, type Query, type Request, type Response, type StorageInfo, type SyncOp, type TagOp } from '../lib/protocol.ts';

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

/** One engine per open DB handle: a tab that was hidden reopens the DB as a new ReaderlogDb. */
let engine: { db: ReaderlogDb; engine: SyncEngine } | null = null;

function syncEngine(d: ReaderlogDb): SyncEngine {
  if (engine?.db !== d) {
    engine = {
      db: d,
      engine: createSyncEngine({
        db: d,
        fetch: (input, init) => fetch(input, init),
        now: () => Date.now(),
        random: (n) => crypto.getRandomValues(new Uint8Array(n)),
        online: () => navigator.onLine,
      }),
    };
  }
  return engine.engine;
}

/**
 * After remote ops were applied (research R4): fold a saved article and its later read copy into one.
 * Anything it wrote is pushed by one more run. Bounded: each pass needs the previous run to have pulled
 * something new, so it cannot loop.
 */
async function reconcileAfterPull(d: ReaderlogDb, e: SyncEngine, pulled: boolean): Promise<boolean> {
  let touched = false;
  for (let pass = 0; pass < 3 && pulled; pass++) {
    if ((await reconcileAll(d, env)) === 0) break;
    touched = true;
    pulled = (await e.run('write')).changed;
  }
  return touched;
}

async function runSync(d: ReaderlogDb, op: SyncOp): Promise<unknown> {
  const e = syncEngine(d);
  const changed = async (pulled: boolean): Promise<void> => {
    const touched = await reconcileAfterPull(d, e, pulled);
    if (pulled || touched) {
      d.invalidateSearch();
      channel.postMessage({ type: 'changed' });
    }
  };
  switch (op.action) {
    case 'run': {
      const r = await e.run(op.reason);
      await changed(r.changed);
      return r;
    }
    case 'status':
      return e.status();
    case 'turnOn': {
      const r = await e.turnOn();
      await changed(r.ok);
      return r;
    }
    case 'join': {
      const r = await e.join(op.code);
      await changed(r.ok);
      return r;
    }
    case 'showCode':
      return e.showCode();
    case 'leave':
      e.leave();
      return null;
    case 'reset': {
      const r = await e.reset();
      await changed(r.ok);
      return r;
    }
  }
}

function close(): void {
  if (!db) return;
  engine = null;
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

/** Local writes that can create a live saved/read pair of one URL. */
const RECONCILES: ReadonlySet<string> = new Set(['AddArticle', 'MarkArticleRead', 'MarkArticleUnread', 'RestoreArticle']);

/** Dispatch one command, then the follow-up every local write needs (cover cache, reconcile, search, other tabs). */
async function commit(d: ReaderlogDb, cmd: Command): Promise<Result<DispatchOutcome, Rejection>> {
  const r = d.dispatch(cmd, env());
  if (!r.ok) return r;
  if (cmd.kind === 'RemoveBook') d.deleteCover(cmd.itemId); // cache maintenance (R5)
  if (RECONCILES.has(cmd.kind)) await reconcileAll(d, env); // a local write can complete a saved/read pair (R4)
  d.invalidateSearch();
  channel.postMessage({ type: 'changed' });
  return r;
}

/** A TEXT column; anything else means the schema changed. */
function col(v: unknown): string {
  if (typeof v !== 'string') throw new TypeError('expected a TEXT column');
  return v;
}

const NO_CHANGES: DispatchOutcome = { offerFinish: false };

/**
 * Tag writes (008 research R3): the ids are derived here, in the shell, from the name key; core only checks them.
 * A merge-rename lists the source's live assignments as `moves`, each with the id it gets on the target tag.
 */
async function tagWrite(d: ReaderlogDb, op: TagOp): Promise<Result<DispatchOutcome, Rejection>> {
  switch (op.action) {
    case 'tagArticle': {
      const tagId = await d.resolveTagId(op.name, uuidFromHash);
      if (tagId === null) return err({ kind: 'InvalidInput', field: 'name', reason: 'required' });
      return commit(d, { kind: 'TagArticle', itemId: op.itemId, tagId, itemTagId: await itemTagId(op.itemId, tagId), name: op.name });
    }
    case 'renameTag': {
      const key = tagKey(op.newName);
      const group = new Set(op.tagIds);
      const other =
        key === null
          ? undefined
          : d.raw
              .selectArrays('SELECT id FROM tags WHERE name_key = ? AND deleted_at IS NULL ORDER BY created_at, id', [key])
              .map((r) => col(r[0]))
              .find((id) => !group.has(id));
      let last: Result<DispatchOutcome, Rejection> = ok(NO_CHANGES);
      for (const tagId of op.tagIds) {
        if (other === undefined) {
          last = await commit(d, { kind: 'RenameTag', tagId, newName: op.newName });
        } else {
          const live = d.raw.selectArrays('SELECT id, item_id FROM item_tags WHERE tag_id = ? AND deleted_at IS NULL ORDER BY id', [tagId]);
          const moves = await Promise.all(
            live.map(async (r) => ({ from: col(r[0]), to: await itemTagId(col(r[1]), other), itemId: col(r[1]) })),
          );
          last = await commit(d, { kind: 'RenameTag', tagId, newName: op.newName, merge: { targetTagId: other, moves } });
        }
        if (!last.ok) return last;
      }
      return last;
    }
    case 'deleteTag': {
      let last: Result<DispatchOutcome, Rejection> = ok(NO_CHANGES);
      for (const tagId of op.tagIds) {
        last = await commit(d, { kind: 'DeleteTag', tagId });
        if (!last.ok) return last;
      }
      return last;
    }
  }
}

function runQuery(d: ReaderlogDb, q: Query): unknown {
  switch (q.name) {
    case 'home':
      return d.home();
    case 'library':
      return d.library();
    case 'articles':
      return d.articles({ ...(q.limit !== undefined ? { limit: q.limit } : {}), ...(q.before ? { before: q.before } : {}) });
    case 'article':
      return d.article(q.itemId);
    case 'findArticleByUrl':
      return d.findArticleByUrl(q.url);
    case 'highlights':
      return d.highlights(q.itemId);
    case 'tagsFor':
      return d.tagsFor(q.itemId);
    case 'allTags':
      return d.allTags();
    case 'tagSuggestions':
      return d.tagSuggestions(q.prefix, q.limit);
    case 'savedArticles':
      return d.savedArticles(q.limit !== undefined ? { limit: q.limit } : {});
    case 'savedCount':
      return d.savedCount();
    case 'savedArticle':
      return d.savedArticle(q.itemId);
    case 'findSavedByUrl':
      return d.findSavedByUrl(q.url);
    case 'articleStats': {
      const today = parseLocalDate(q.today);
      if (!today.ok) throw new Error(`bad today: ${today.error.reason}`);
      return d.articleStats(q.year, today.value);
    }
    case 'book': {
      const today = parseLocalDate(q.today);
      if (!today.ok) throw new Error(`bad today: ${today.error.reason}`);
      return d.book(q.itemId, today.value);
    }
    case 'stats': {
      const today = parseLocalDate(q.today);
      if (!today.ok) throw new Error(`bad today: ${today.error.reason}`);
      return d.stats(q.year, today.value);
    }
    case 'findByIsbn':
      return d.findByIsbn(q.isbn);
    case 'pendingDetails':
      return d.pendingDetails();
    case 'missingCovers':
      return d.missingCovers();
    case 'duplicates':
      return d.duplicates();
    case 'stragglers':
      return d.stragglers();
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
        const r = await commit(d, req.cmd);
        return r.ok ? { id: req.id, ok: true, result: r.value } : { id: req.id, ok: false, error: r.error };
      }
      case 'tag': {
        const r = await tagWrite(d, req.op);
        return r.ok ? { id: req.id, ok: true, result: r.value } : { id: req.id, ok: false, error: r.error };
      }
      case 'query':
        return { id: req.id, ok: true, result: runQuery(d, req.q) };
      case 'storeCover':
        return { id: req.id, ok: true, result: { stored: await storeCover(d, req.itemId, req.image) } };
      case 'sync':
        return { id: req.id, ok: true, result: await runSync(d, req.op) };
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
