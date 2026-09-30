// The extension's push-only sync peer (005 research R7, contracts/extension.md). It holds no
// SQLite: state lives in a CaptureStore (chrome.storage.local in the extension, a Map in tests).
// It must not import packages/db or engine.ts (dependency-cruiser `capture-peer-no-db`), so the
// extension bundle stays free of WASM. It never calls GET /batches (FR-012).
import {
  decide,
  err,
  normalizeUrl,
  ok,
  stampOps,
  type BookSnapshot,
  type DeviceId,
  type Hlc,
  type Instant,
  type OpWire,
  type Result,
} from '@readerlog/core';
import { parseSyncCode } from './code.ts';
import { seal } from './envelope.ts';
import { uuidFromHash } from './ids.ts';
import { deriveKeys, type SyncKeys } from './keys.ts';
import { pushAll, type PushSource } from './push.ts';
import { createRelayClient, type RelayClient, type RelayFailure } from './relayClient.ts';

export interface CaptureStore {
  get<T>(k: string): Promise<T | undefined>;
  set(patch: Record<string, unknown>): Promise<void>;
}

export interface CapturePeerDeps {
  fetch: typeof fetch;
  now: () => number;
  random: (n: number) => Uint8Array;
  online: () => boolean;
}

export type SyncError = { kind: 'format' | 'checksum' | 'notFound' | 'offline' | 'relay'; status?: number };
export type SyncProblem = 'offline' | 'relay' | 'spaceGone' | 'unauthorized';

export interface CaptureInput {
  url: string;
  title: string;
  author: string | null;
  words: number | null;
  /** The capture instant (ISO 8601 UTC). Part of the derived item id (research R5). */
  at: string;
  /** The local date of the capture, computed by the shell. */
  readOn: string;
  /** Log again: skip the duplicate check. */
  force?: boolean;
}

export interface CapturePeer {
  pair(appOrigin: string, code: string): Promise<Result<void, SyncError>>;
  unpair(): Promise<void>;
  capture(p: CaptureInput): Promise<Result<{ itemId: string; duplicateOf?: { readOn: string } }, 'notPaired' | 'invalid'>>;
  undo(itemId: string): Promise<void>;
  flush(): Promise<{ sent: number; problem: SyncProblem | null }>;
  status(): Promise<{ paired: boolean; waiting: number; lastSentAt: string | null; problem: SyncProblem | null }>;
}

interface CapturedEntry {
  itemId: string;
  readOn: string;
  at: string;
  removed: boolean;
}
type Captured = Record<string, CapturedEntry>;
interface PendingBatch {
  batchId: string;
  count: number;
}
interface StatusRecord {
  lastSentAt: string | null;
  problem: SyncProblem | null;
}

const MAX_CAPTURED = 5000;

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function problemOf(f: RelayFailure): SyncProblem {
  switch (f.kind) {
    case 'offline': return 'offline';
    case 'unauthorized': return 'unauthorized';
    case 'notFound': return 'spaceGone';
    default: return 'relay';
  }
}

export function createCapturePeer(store: CaptureStore, deps: CapturePeerDeps): CapturePeer {
  /** A lowercase v4 uuid from the injected randomness. */
  function newUuid(): string {
    const b = deps.random(16).slice();
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Storage read-modify-write cycles must not interleave (a capture racing an alarm flush).
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  }

  const clientFor = (origin: string, keys: SyncKeys): RelayClient =>
    createRelayClient((path, init) => deps.fetch(origin + (typeof path === 'string' ? path : path instanceof URL ? path.href : path.url), init), keys.spaceId, keys.authToken, deps.online);

  async function deviceId(): Promise<DeviceId> {
    const existing = await store.get<string>('deviceId');
    if (existing) return existing as DeviceId;
    const id = newUuid();
    await store.set({ deviceId: id });
    return id as DeviceId;
  }

  /** Stamp `changes`, append to `pending` and persist with `extra` in one write. */
  async function stampAndStore(changes: Parameters<typeof stampOps>[0], extra: Record<string, unknown>): Promise<void> {
    const stamped = stampOps(changes, {
      hlc: (await store.get<Hlc | null>('hlc')) ?? null,
      deviceId: await deviceId(),
      wallMs: deps.now(),
      newOpId: newUuid,
    });
    const pending = (await store.get<OpWire[]>('pending')) ?? [];
    await store.set({ pending: [...pending, ...stamped.ops], hlc: stamped.hlc, ...extra });
  }

  async function flushLocked(): Promise<{ sent: number; problem: SyncProblem | null }> {
    const key = await store.get<string>('syncKey');
    const origin = await store.get<string>('appOrigin');
    if (!key || !origin) return { sent: 0, problem: null };
    const waiting = ((await store.get<OpWire[]>('pending')) ?? []).length;
    if (waiting === 0 && !(await store.get<PendingBatch | null>('pendingBatch'))) return { sent: 0, problem: null };

    const status = (await store.get<StatusRecord>('status')) ?? { lastSentAt: null, problem: null };
    const keys = await deriveKeys(fromB64url(key));
    const device = await deviceId();
    // The token is a count of ops from the head of `pending`: only this peer appends (at the tail)
    // and only complete() removes (from the head), so a re-sent batch has the same content.
    const source: PushSource<number> = {
      async next(limit, upTo) {
        const pending = (await store.get<OpWire[]>('pending')) ?? [];
        const ops = pending.slice(0, Math.min(limit, upTo ?? Infinity));
        return { ops, token: ops.length };
      },
      async complete(token) {
        const pending = (await store.get<OpWire[]>('pending')) ?? [];
        await store.set({ pending: pending.slice(token), pendingBatch: null });
      },
      async pending() {
        const p = await store.get<PendingBatch | null>('pendingBatch');
        return p ? { batchId: p.batchId, token: p.count } : null;
      },
      async setPending(p) {
        await store.set({ pendingBatch: p ? { batchId: p.batchId, count: p.token } : null });
      },
    };
    const out = await pushAll(source, {
      client: clientFor(origin, keys),
      seal: (ops, batchId) => seal({ v: 1, device, ops }, keys.encKey, keys.spaceId, batchId),
      newBatchId: newUuid,
    });
    const problem = out.failure ? problemOf(out.failure) : null;
    await store.set({
      status: {
        lastSentAt: out.pushed > 0 ? new Date(deps.now()).toISOString() : status.lastSentAt,
        problem,
      } satisfies StatusRecord,
    });
    return { sent: out.pushed, problem };
  }

  return {
    async pair(appOrigin, code) {
      const origin = appOrigin.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^/?#\s]+$/i.test(origin)) return err<SyncError>({ kind: 'format' });
      const k = parseSyncCode(code);
      if (!k.ok) return err<SyncError>({ kind: k.error });
      const keys = await deriveKeys(k.value);
      const found = await clientFor(origin, keys).spaceExists();
      if (!found.ok) {
        if (found.kind === 'offline') return err<SyncError>({ kind: 'offline' });
        if (found.kind === 'notFound' || found.kind === 'unauthorized') return err<SyncError>({ kind: 'notFound' });
        return err<SyncError>({ kind: 'relay', ...('status' in found && found.status !== undefined ? { status: found.status } : {}) });
      }
      await serial(() =>
        store.set({
          appOrigin: origin,
          syncKey: b64url(k.value),
          pending: [],
          pendingBatch: null,
          captured: {},
          status: { lastSentAt: null, problem: null },
        }),
      );
      return ok(undefined);
    },

    unpair: () =>
      serial(() =>
        store.set({ appOrigin: null, syncKey: null, pending: [], pendingBatch: null, captured: {}, status: { lastSentAt: null, problem: null } }),
      ),

    capture: (p) =>
      serial(async () => {
        if (!(await store.get<string>('syncKey'))) return err('notPaired' as const);
        const url = normalizeUrl(p.url);
        if (!url.ok) return err('invalid' as const);
        const itemId = await uuidFromHash(`readerlog-capture-v1|${url.value}|${p.at}`);
        const captured = (await store.get<Captured>('captured')) ?? {};
        const known = captured[url.value];
        // Same url and at: the same capture again, nothing to do.
        if (known && known.itemId === itemId) return ok({ itemId });
        if (known && !known.removed && p.force !== true) {
          return ok({ itemId: known.itemId, duplicateOf: { readOn: known.readOn } });
        }
        const decided = decide(
          null,
          {
            kind: 'AddArticle',
            itemId,
            url: p.url,
            title: p.title,
            author: p.author,
            wordCount: p.words,
            readOn: p.readOn,
            detailsStatus: 'complete',
          },
          new Date(deps.now()).toISOString() as Instant,
        );
        if (!decided.ok) return err('invalid' as const);
        delete captured[url.value]; // re-insert last, so trimming drops the oldest
        captured[url.value] = { itemId, readOn: p.readOn, at: p.at, removed: false };
        for (const k of Object.keys(captured).slice(0, Math.max(0, Object.keys(captured).length - MAX_CAPTURED))) delete captured[k];
        await stampAndStore(decided.value.changes, { captured });
        return ok({ itemId });
      }),

    undo: (itemId) =>
      serial(async () => {
        const captured = (await store.get<Captured>('captured')) ?? {};
        const url = Object.keys(captured).find((u) => captured[u]!.itemId === itemId);
        if (url === undefined || captured[url]!.removed) return;
        const snapshot = { item: { id: itemId, type: 'article', deletedAt: null }, events: [] } as unknown as BookSnapshot;
        const decided = decide(snapshot, { kind: 'RemoveArticle', itemId }, new Date(deps.now()).toISOString() as Instant);
        if (!decided.ok) return;
        captured[url] = { ...captured[url]!, removed: true };
        await stampAndStore(decided.value.changes, { captured });
      }),

    flush: () => serial(flushLocked),

    async status() {
      const s = (await store.get<StatusRecord>('status')) ?? { lastSentAt: null, problem: null };
      return {
        paired: Boolean(await store.get<string>('syncKey')),
        waiting: ((await store.get<OpWire[]>('pending')) ?? []).length,
        lastSentAt: s.lastSentAt,
        problem: s.problem,
      };
    },
  };
}
