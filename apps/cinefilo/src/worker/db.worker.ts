/// <reference lib="webworker" />
import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { CinefiloDb, cinefiloSyncApp, reconcileAll, type DispatchEnv } from '@especulati/cinefilo-db';
import type { Instant, Rejection } from '@especulati/cinefilo-core';
import { createSyncEngine, type SyncEngine } from '@especulati/sync';
import { CHANNEL, DB_FILE, LOCK, SAH_POOL_NAME } from './frozen.ts';
import { resolveCommand } from '../lib/commands.ts';
import { uuidFromHash } from '../lib/ids.ts';
import type { ClientError, Control, IdentityOp, Query, Request, Response, SyncOp } from '../lib/protocol.ts';

/**
 * Owns the on-device database. Same scheme as lector's worker (a copy, not shared: lector's frozen
 * worker stays untouched): opfs-sahpool allows one connection, so tabs take turns through the Web
 * Lock; a hidden tab closes the DB, pauses the VFS and releases the lock.
 */
const LOCK_TIMEOUT_MS = 5000;

let sqlite3: Sqlite3Static | null = null;
let pool: SAHPoolUtil | null = null;
const channel = new BroadcastChannel(CHANNEL);
let db: CinefiloDb | null = null;
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

async function open(): Promise<CinefiloDb> {
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
    const opened = new CinefiloDb(raw);
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
  engine = null;
  db.raw.close();
  db = null;
  pool?.pauseVfs();
  releaseLock?.();
  releaseLock = null;
}

/** One engine per open DB handle: a tab that was hidden reopens the DB as a new CinefiloDb. */
let engine: { db: CinefiloDb; engine: SyncEngine } | null = null;

function syncEngine(d: CinefiloDb): SyncEngine {
  if (engine?.db !== d) {
    engine = {
      db: d,
      engine: createSyncEngine({
        store: d.syncStore,
        app: cinefiloSyncApp,
        fetch: (input, init) => fetch(input, init),
        now: () => Date.now(),
        random: (n) => crypto.getRandomValues(new Uint8Array(n)),
        online: () => navigator.onLine,
      }),
    };
  }
  return engine.engine;
}

function env(): DispatchEnv {
  return {
    now: new Date().toISOString() as Instant,
    wallMs: () => Date.now(),
    newOpId: () => crypto.randomUUID(),
  };
}

/**
 * After remote ops were applied (D4): fold titles that share a TMDB id into one. Anything it wrote is
 * pushed by one more run. Bounded: each pass needs the previous run to have pulled something new.
 */
async function reconcileAfterPull(d: CinefiloDb, e: SyncEngine, pulled: boolean): Promise<boolean> {
  let touched = false;
  for (let pass = 0; pass < 3 && pulled; pass++) {
    if ((await reconcileAll(d, env, uuidFromHash)) === 0) break;
    touched = true;
    pulled = (await e.run('write')).changed;
  }
  return touched;
}

async function runSync(d: CinefiloDb, op: SyncOp): Promise<unknown> {
  const e = syncEngine(d);
  const changed = async (pulled: boolean): Promise<void> => {
    const touched = await reconcileAfterPull(d, e, pulled);
    if (pulled || touched) channel.postMessage({ type: 'changed' });
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

type Reply = { ok: true; result: unknown } | { ok: false; error: Rejection };
const ok = (result: unknown): Reply => ({ ok: true, result });
const rejected = (error: Rejection): Reply => ({ ok: false, error });

/** Create a member for this device ("start a list" or "I'm new") and make it this device's identity. */
function becomeNewMember(d: CinefiloDb, name: string): Reply {
  const memberId = crypto.randomUUID();
  const r = d.dispatch({ kind: 'CreateMember', memberId, name }, env());
  if (!r.ok) return rejected(r.error);
  d.setMeta('member_id', memberId);
  return ok({ memberId });
}

async function identity(d: CinefiloDb, op: IdentityOp): Promise<Reply> {
  switch (op.action) {
    case 'startSpace': {
      const made = becomeNewMember(d, op.name);
      if (!made.ok) return made;
      const r = await runSync(d, { action: 'turnOn' });
      channel.postMessage({ type: 'changed' });
      return ok({ ...(made.result as object), sync: r });
    }
    case 'createMember': {
      const r = becomeNewMember(d, op.name);
      channel.postMessage({ type: 'changed' });
      return r;
    }
    case 'setMe': {
      if (!d.members().some((m) => m.id === op.memberId)) return rejected({ kind: 'UnknownMember' });
      d.setMeta('member_id', op.memberId);
      channel.postMessage({ type: 'changed' });
      return ok({ memberId: op.memberId });
    }
  }
}

/** Dispatch one UI command, then the follow-up every local write needs (reconcile, other tabs). */
async function commit(d: CinefiloDb, req: Extract<Request, { kind: 'dispatch' }>): Promise<Reply> {
  const resolved = await resolveCommand(d.memberId, req.cmd);
  if (!resolved.ok) return rejected(resolved.error);
  const r = d.dispatch(resolved.cmd, env());
  if (!r.ok) return rejected(r.error);
  // A local add or link can complete a pair of titles with one TMDB id (D4).
  if (resolved.cmd.kind === 'AddTitle' || resolved.cmd.kind === 'LinkToTmdb') await reconcileAll(d, env, uuidFromHash);
  channel.postMessage({ type: 'changed' });
  return ok(r.value);
}

/** Leave: forget the sync code, then delete the database files. The next request creates a fresh database. */
async function erase(d: CinefiloDb): Promise<void> {
  syncEngine(d).leave();
  engine = null;
  d.raw.close();
  db = null;
  await pool?.wipeFiles();
  pool?.pauseVfs();
  releaseLock?.();
  releaseLock = null;
  channel.postMessage({ type: 'changed' });
}

function runQuery(d: CinefiloDb, q: Query): unknown {
  switch (q.name) {
    case 'list':
      return d.list(q.tab, q.filter);
    case 'title':
      return d.title(q.id);
    case 'members':
      return d.members();
    case 'me':
      return { memberId: d.memberId, deviceId: d.getMeta('device_id') ?? '' };
    case 'findByTmdb':
      return d.findByTmdb(q.tmdbId, q.kind);
  }
}

function toClientError(e: unknown): ClientError {
  if (e instanceof BusyError) return { kind: 'Busy' };
  return { kind: 'Storage', message: e instanceof Error ? e.message : String(e) };
}

async function handle(req: Request): Promise<Response> {
  try {
    while (!wantOpen) await new Promise<void>((r) => resumeWaiters.push(r));
    const d = await open();
    let reply: Reply;
    switch (req.kind) {
      case 'ping':
        reply = ok(null);
        break;
      case 'dispatch':
        reply = await commit(d, req);
        break;
      case 'query':
        reply = ok(runQuery(d, req.q));
        break;
      case 'sync':
        reply = ok(await runSync(d, req.op));
        break;
      case 'identity':
        reply = await identity(d, req.op);
        break;
      case 'export':
        reply = ok(d.exportText(new Date().toISOString() as Instant));
        break;
      case 'erase':
        await erase(d);
        reply = ok(null);
        break;
      case 'import': {
        const r = d.import(req.text, env());
        if (r.ok) channel.postMessage({ type: 'changed' });
        reply = ok(r); // a bad file is an answer, not a failure: `{ ok: false, error: { field, reason } }`
        break;
      }
    }
    return { id: req.id, ...reply };
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
