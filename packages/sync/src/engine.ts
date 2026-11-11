import { err, ok, parseRemoteOp, type Instant, type RemoteOp, type Result } from '@especulati/lector-core';
import type { LectorDb, SyncProblem, SyncStatus } from '@especulati/lector-db';
import { formatSyncCode, newSyncSecret, parseSyncCode, qrPayload } from './code.ts';
import { open, seal } from './envelope.ts';
import { deriveKeys, type SyncKeys } from './keys.ts';
import { pushAll, type PushSource } from './push.ts';
import { createRelayClient, type RelayClient, type RelayFailure } from './relayClient.ts';

export interface SyncDeps {
  db: LectorDb;
  fetch: typeof fetch;
  now: () => number;
  random: (n: number) => Uint8Array;
  online: () => boolean;
}

export type SyncError = { kind: 'format' | 'checksum' | 'notFound' | 'offline' | 'relay'; status?: number };

export interface SyncStatusView {
  on: boolean;
  lastOkAt: string | null;
  pending: number;
  problem: SyncProblem | null;
  undecryptable: number;
  /** Inbox rows that outlived one full pull: their row never arrived. */
  inboxStuck: number;
}

export interface SyncRunResult {
  /** Remote ops applied by this run. */
  pulled: number;
  /** Local ops pushed by this run. */
  pushed: number;
  /** True only when remote ops were applied, so the UI needs to refresh. */
  changed: boolean;
  problem: SyncProblem | null;
  /** When to try again after a relay failure (30 s, 2 min, then 10 min). No timers here: the shell schedules. */
  backoffMs: number | null;
}

export type SyncReason = 'start' | 'visible' | 'online' | 'write' | 'manual';

export interface SyncEngine {
  status(): SyncStatusView;
  turnOn(): Promise<Result<{ code: string; qr: string }, SyncError>>;
  join(code: string): Promise<Result<{ duplicates: number }, SyncError>>;
  leave(): void;
  /** A new space and code, every change pushed to it, then the old space deleted (research R7). */
  reset(): Promise<Result<{ code: string; qr: string }, SyncError>>;
  showCode(): { code: string; qr: string } | null;
  run(reason: SyncReason, opts?: { pushOnly?: boolean }): Promise<SyncRunResult>;
}

const PULL_LIMIT = 50;
const BACKOFF_MS = [30_000, 120_000, 600_000] as const;
/** Problems that end sync until the user rejoins (FR-021). */
const STOPPED: readonly SyncProblem[] = ['unauthorized', 'spaceGone'];

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

interface Session {
  keys: SyncKeys;
  client: RelayClient;
}

export function createSyncEngine(deps: SyncDeps): SyncEngine {
  const { db } = deps;
  const sessions = new Map<string, Session>();
  let current: Promise<SyncRunResult> | null = null;
  let again: { pushOnly: boolean } | null = null;
  let failures = 0;
  let stuck = new Set<string>();

  /** A lowercase v4 uuid from the injected randomness (the relay lowercases batch ids; the AAD includes them). */
  function newUuid(): string {
    const b = deps.random(16).slice();
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async function sessionFor(key: string): Promise<Session> {
    let s = sessions.get(key);
    if (!s) {
      const keys = await deriveKeys(fromB64url(key));
      s = { keys, client: createRelayClient(deps.fetch, keys.spaceId, keys.authToken, deps.online) };
      sessions.set(key, s);
    }
    return s;
  }

  const currentStatus = (): SyncStatus => db.syncMeta().status ?? { lastOkAt: null, problem: null, undecryptable: 0 };
  const setStatus = (patch: Partial<SyncStatus>): void => db.setSyncMeta({ status: { ...currentStatus(), ...patch } });
  const wallMs = (): number => deps.now();

  function problemOf(f: RelayFailure): SyncProblem {
    switch (f.kind) {
      case 'offline': return 'offline';
      case 'unauthorized': return 'unauthorized';
      case 'notFound': return 'spaceGone';
      default: return 'relay';
    }
  }

  function fail(res: SyncRunResult, f: RelayFailure): SyncRunResult {
    const problem = problemOf(f);
    setStatus({ problem });
    res.problem = problem;
    if (problem === 'relay') {
      res.backoffMs = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
      failures++;
    }
    return res;
  }

  /** Pull every page. Returns a failure, or null when caught up (or stopped at a newer version). */
  async function pull(s: Session, res: SyncRunResult): Promise<RelayFailure | null> {
    const before = new Set(db.inboxOpIds());
    let cursor = db.syncMeta().cursor;
    for (;;) {
      const page = await s.client.getBatches(cursor, PULL_LIMIT);
      if (!page.ok) return page;
      const ops: RemoteOp[] = [];
      let last = cursor;
      let skipped = 0;
      let newer = false;
      for (const b of page.value.batches) {
        const opened = await open(b, s.keys.encKey, s.keys.spaceId);
        if (!opened.ok) {
          if (opened.error === 'version') {
            newer = true;
            break;
          }
          skipped++;
          last = b.seq;
          continue;
        }
        const parsed: RemoteOp[] = [];
        let good = true;
        for (const w of opened.value.ops) {
          const p = parseRemoteOp(w, opened.value.device);
          if (!p.ok) {
            good = false;
            break;
          }
          parsed.push(p.value);
        }
        // A batch is applied whole or not at all.
        if (good) ops.push(...parsed);
        else skipped++;
        last = b.seq;
      }
      if (last !== cursor) {
        const applied = db.applyPulledPage(ops, last, wallMs);
        res.pulled += applied.applied;
        cursor = last;
      }
      if (skipped > 0) setStatus({ undecryptable: currentStatus().undecryptable + skipped });
      if (newer) {
        res.problem = 'newerVersion';
        return null;
      }
      if (!page.value.more) break;
    }
    const now = new Set(db.inboxOpIds());
    stuck = new Set([...before].filter((id) => now.has(id)));
    return null;
  }

  /** The push source over the local DB: the token is the change_log seq the batch reaches up to. */
  const source: PushSource<number> = {
    next: (limit, upTo) => {
      const { maxSeq, ops } = db.unpushedOps(limit, upTo);
      return { ops, token: maxSeq };
    },
    complete: (token) => db.completePush(token),
    pending: () => {
      const p = db.syncMeta().pendingBatch;
      return p ? { batchId: p.batchId, token: p.maxSeq } : null;
    },
    setPending: (p) => db.setSyncMeta({ pendingBatch: p ? { batchId: p.batchId, maxSeq: p.token } : null }),
  };

  async function push(s: Session, res: SyncRunResult): Promise<RelayFailure | null> {
    const out = await pushAll(source, {
      client: s.client,
      seal: (ops, batchId) => seal({ v: 1, device: db.getMeta('device_id') ?? '', ops }, s.keys.encKey, s.keys.spaceId, batchId),
      newBatchId: newUuid,
    });
    res.pushed += out.pushed;
    return out.failure;
  }

  /** After a reset: the old space is deleted only once the new one holds everything. A failure is retried on later runs. */
  async function deleteOldSpace(): Promise<void> {
    const old = db.syncMeta().oldSpace;
    if (old === null) return;
    const r = await (await sessionFor(old)).client.deleteSpace();
    // Already gone counts as done.
    if (r.ok || r.kind === 'notFound' || r.kind === 'unauthorized') {
      db.setSyncMeta({ oldSpace: null });
      sessions.delete(old);
    }
  }

  async function runOnce(pushOnly: boolean): Promise<SyncRunResult> {
    const res: SyncRunResult = { pulled: 0, pushed: 0, changed: false, problem: null, backoffMs: null };
    const meta = db.syncMeta();
    if (meta.key === null) return res;
    const stopped = meta.status?.problem;
    if (stopped && STOPPED.includes(stopped)) {
      res.problem = stopped;
      return res;
    }
    if (!deps.online()) return fail(res, { kind: 'offline' });
    const s = await sessionFor(meta.key);

    // Pull, then push (research R6). A batch that may or may not have reached the relay is
    // re-sent first within push, with the same id. Push-only peers skip the pull (FR-025).
    let failure: RelayFailure | null = null;
    if (!pushOnly) failure = await pull(s, res);
    res.changed = res.pulled > 0;
    if (!failure) failure = await push(s, res);
    if (failure) return fail(res, failure);

    failures = 0;
    await deleteOldSpace();
    if (res.problem === 'newerVersion') setStatus({ problem: 'newerVersion' });
    else setStatus({ lastOkAt: new Date(deps.now()).toISOString() as Instant, problem: null });
    return res;
  }

  async function loop(first: boolean): Promise<SyncRunResult> {
    const total: SyncRunResult = { pulled: 0, pushed: 0, changed: false, problem: null, backoffMs: null };
    let pushOnly = first;
    do {
      again = null;
      const r = await runOnce(pushOnly);
      total.pulled += r.pulled;
      total.pushed += r.pushed;
      total.changed ||= r.changed;
      total.problem = r.problem;
      total.backoffMs = r.backoffMs;
      if (again) pushOnly = (again as { pushOnly: boolean }).pushOnly;
    } while (again && total.problem === null);
    return total;
  }

  function begin(secret: Uint8Array, oldSpace: string | null = null): void {
    db.setSyncMeta({ key: b64url(secret), pendingBatch: null, status: null, oldSpace });
    db.resetPushState();
    failures = 0;
    stuck = new Set();
  }

  const codeFor = (k: Uint8Array) => ({ code: formatSyncCode(k), qr: qrPayload(k) });

  function run(_reason: SyncReason, opts?: { pushOnly?: boolean }): Promise<SyncRunResult> {
    const pushOnly = opts?.pushOnly === true;
    if (current) {
      // A trigger during a run: run once more afterwards. Any full request beats a push-only one.
      again = { pushOnly: again ? again.pushOnly && pushOnly : pushOnly };
      return current;
    }
    const p = loop(pushOnly).finally(() => {
      current = null;
    });
    current = p;
    return p;
  }

  return {
    run,
    status() {
      const meta = db.syncMeta();
      const inbox = new Set(db.inboxOpIds());
      return {
        on: meta.key !== null,
        lastOkAt: meta.status?.lastOkAt ?? null,
        pending: db.pendingCount(),
        problem: meta.status?.problem ?? null,
        undecryptable: meta.status?.undecryptable ?? 0,
        inboxStuck: [...stuck].filter((id) => inbox.has(id)).length,
      };
    },

    async turnOn() {
      const secret = newSyncSecret(deps.random);
      const keys = await deriveKeys(secret);
      const client = createRelayClient(deps.fetch, keys.spaceId, keys.authToken, deps.online);
      const created = await client.createSpace();
      if (!created.ok) {
        return err<SyncError>(created.kind === 'offline' ? { kind: 'offline' } : { kind: 'relay', ...('status' in created ? { status: created.status } : {}) });
      }
      begin(secret);
      await run('manual');
      return ok(codeFor(secret));
    },

    async join(code) {
      const k = parseSyncCode(code);
      if (!k.ok) return err<SyncError>({ kind: k.error });
      const keys = await deriveKeys(k.value);
      const client = createRelayClient(deps.fetch, keys.spaceId, keys.authToken, deps.online);
      const found = await client.spaceExists();
      if (!found.ok) {
        if (found.kind === 'offline') return err<SyncError>({ kind: 'offline' });
        if (found.kind === 'notFound' || found.kind === 'unauthorized') return err<SyncError>({ kind: 'notFound' });
        return err<SyncError>({ kind: 'relay', ...('status' in found ? { status: found.status } : {}) });
      }
      begin(k.value);
      await run('manual');
      return ok({ duplicates: db.duplicates().length });
    },

    leave() {
      // Local rows stay. An owed DELETE of an old space is dropped with the rest: the code is forgotten.
      db.setSyncMeta({ key: null, cursor: null, pendingBatch: null, status: null, oldSpace: null });
      failures = 0;
      stuck = new Set();
    },

    async reset() {
      const oldKey = db.syncMeta().key;
      if (oldKey === null) return err<SyncError>({ kind: 'notFound' });
      const secret = newSyncSecret(deps.random);
      const keys = await deriveKeys(secret);
      const client = createRelayClient(deps.fetch, keys.spaceId, keys.authToken, deps.online);
      const created = await client.createSpace();
      if (!created.ok) {
        return err<SyncError>(created.kind === 'offline' ? { kind: 'offline' } : { kind: 'relay', ...('status' in created ? { status: created.status } : {}) });
      }
      // `oldSpace` holds the old sync code: deleting a space needs its token, not just its id.
      // begin() marks every change_log row unpushed, so this run uploads all of them; the old
      // space is deleted at the end of the first fully successful run.
      begin(secret, oldKey);
      await run('manual');
      return ok(codeFor(secret));
    },

    showCode() {
      const key = db.syncMeta().key;
      return key === null ? null : codeFor(fromB64url(key));
    },
  };
}
