// The extension's push-only sync peer (005 research R7, contracts/extension.md). It holds no
// SQLite: state lives in a CaptureStore (chrome.storage.local in the extension, a Map in tests).
// It must not import packages/lector-db or db-kit (dependency-cruiser `lector-sync-no-db`), so the
// extension bundle stays free of WASM. It never calls GET /batches (FR-012).
import {
  decide,
  err,
  normalizeUrl,
  ok,
  stampOps,
  tagKey,
  tagName,
  tierOf,
  detailsStatusFromDb,
  type BookSnapshot,
  type Change,
  type FieldValue,
  type TagSnapshot,
  type DeviceId,
  type Hlc,
  type HighlightSnapshot,
  type Instant,
  type OpWire,
  type Table,
  type Result,
} from '@especulati/lector-core';
import {
  createRelayClient, deriveKeys, parseSyncCode, pushAll, seal, uuidFromHash,
  type PushSource, type RelayClient, type RelayFailure, type SyncKeys,
} from '@especulati/sync';
import { CAPTURE_ID_LABEL, ENVELOPE_AAD_PREFIX, HIGHLIGHT_ID_LABEL, ITEM_TAG_ID_LABEL, SYNC_SALT, TAG_ID_LABEL } from './frozen.ts';

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

export interface SaveInput {
  url: string;
  title: string;
  author: string | null;
  words: number | null;
  /** The save instant (ISO 8601 UTC). Part of the derived item id, with `|later`. */
  at: string;
  /** `notFound` for a link saved by URL alone (no page was read). */
  detailsStatus?: 'complete' | 'notFound';
}

export interface CapturePeer {
  pair(appOrigin: string, code: string): Promise<Result<void, SyncError>>;
  unpair(): Promise<void>;
  capture(p: CaptureInput): Promise<Result<{ itemId: string; duplicateOf?: { readOn: string } }, 'notPaired' | 'invalid'>>;
  /** 008: save for later (`AddArticle` with no `readOn`; `read_on: null` is emitted explicitly). */
  save(p: SaveInput): Promise<Result<{ itemId: string; alreadySaved?: true }, 'notPaired' | 'invalid'>>;
  /** 008: add tags to a captured article. Names that are invalid, repeated or over the limit are counted in `dropped`. */
  tag(itemId: string, names: readonly string[]): Promise<Result<{ added: number; dropped: number }, 'notPaired' | 'invalid'>>;
  undo(itemId: string): Promise<void>;
  /** 007: save a quote under an article already in `captured`. The id derives from the article url and `at`. */
  highlight(p: {
    itemId: string;
    quote: string;
    note?: string;
    at: string;
    localDate: string;
  }): Promise<Result<{ highlightId: string }, 'notPaired' | 'invalid' | 'tooLong'>>;
  editNote(highlightId: string, note: string): Promise<Result<void, 'invalid' | 'tooLong'>>;
  undoHighlight(highlightId: string): Promise<void>;
  flush(): Promise<{ sent: number; problem: SyncProblem | null }>;
  status(): Promise<{ paired: boolean; waiting: number; lastSentAt: string | null; problem: SyncProblem | null }>;
}

interface CapturedEntry {
  itemId: string;
  readOn: string;
  at: string;
  removed: boolean;
  /** 008: saved for later and not yet marked read. */
  saved?: boolean;
  /** 008: the article's insert fields as stamped, so MarkArticleRead can carry the full row (S-2). */
  row?: Record<string, FieldValue>;
  /** 008: ids of the tags added from here (the extension cannot see the PWA's tags). */
  tagIds?: string[];
}
type Captured = Record<string, CapturedEntry>;
interface HighlightEntry {
  itemId: string;
  quote: string | null;
  note: string | null;
  /** The save instant: chrome.storage does not keep key order, so trimming sorts on this. */
  at: string;
  removed?: boolean;
}
type Highlights = Record<string, HighlightEntry>;
interface PendingBatch {
  batchId: string;
  count: number;
}
interface StatusRecord {
  lastSentAt: string | null;
  problem: SyncProblem | null;
}

const MAX_CAPTURED = 5000;
const MAX_HIGHLIGHTS = 2000;

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

/** The minimal snapshot decide() needs for the highlight commands (contracts/extension-highlight.md). */
function highlightSnapshot(itemId: string, highlightId: string, highlights: Highlights): HighlightSnapshot {
  const h = highlights[highlightId];
  return {
    item: { id: itemId, type: 'article', deletedAt: null },
    highlight: h
      ? { id: highlightId, itemId: h.itemId, quote: h.quote, note: h.note, page: null, createdAt: '', localDate: '', deletedAt: h.removed ? '1970-01-01T00:00:00.000Z' : null }
      : null,
  } as unknown as HighlightSnapshot;
}

/** The snapshot decide() needs to mark a saved entry read: the row as captured. */
function savedSnapshot(itemId: string, row: Record<string, FieldValue>): BookSnapshot {
  return {
    item: {
      id: itemId,
      type: 'article',
      title: row['title'],
      url: row['url'],
      domain: row['domain'],
      author: row['author'],
      wordCount: row['word_count'],
      detailsStatus: detailsStatusFromDb(String(row['metadata_status'])),
      createdAt: row['created_at'],
      deletedAt: null,
      readOn: null,
    },
    events: [],
  } as unknown as BookSnapshot;
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

  /** MarkArticleRead for a saved entry, or null when decide() refuses. */
  function markRead(entry: CapturedEntry, readOn: string, now: Instant): readonly Change[] | null {
    const d = decide(savedSnapshot(entry.itemId, entry.row!), { kind: 'MarkArticleRead', itemId: entry.itemId, readOn }, now);
    return d.ok ? d.value.changes : null;
  }

  async function flushLocked(): Promise<{ sent: number; problem: SyncProblem | null }> {
    const key = await store.get<string>('syncKey');
    const origin = await store.get<string>('appOrigin');
    if (!key || !origin) return { sent: 0, problem: null };
    const waiting = ((await store.get<OpWire[]>('pending')) ?? []).length;
    if (waiting === 0 && !(await store.get<PendingBatch | null>('pendingBatch'))) return { sent: 0, problem: null };

    const status = (await store.get<StatusRecord>('status')) ?? { lastSentAt: null, problem: null };
    const keys = await deriveKeys(fromB64url(key), SYNC_SALT);
    const device = await deviceId();
    // The token is a count of ops from the head of `pending`: only this peer appends (at the tail)
    // and only complete() removes (from the head), so a re-sent batch has the same content.
    const source: PushSource<number> = {
      async next(limit, upTo) {
        const pending = (await store.get<OpWire[]>('pending')) ?? [];
        const max = Math.min(limit, upTo ?? Infinity);
        // Never mix tiers in one batch (007 R2): stop at the first op of another tier.
        const tier = pending.length > 0 ? tierOf(pending[0]!.tbl as Table, pending[0]!.fields) : null;
        let n = 0;
        while (n < pending.length && n < max && tierOf(pending[n]!.tbl as Table, pending[n]!.fields) === tier) n++;
        const ops = pending.slice(0, n);
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
      seal: (ops, batchId) => seal({ v: 1, device, ops }, keys.encKey, keys.spaceId, batchId, ENVELOPE_AAD_PREFIX),
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
      const keys = await deriveKeys(k.value, SYNC_SALT);
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
          highlights: {},
          status: { lastSentAt: null, problem: null },
        }),
      );
      return ok(undefined);
    },

    unpair: () =>
      serial(() =>
        store.set({ appOrigin: null, syncKey: null, pending: [], pendingBatch: null, captured: {}, highlights: {}, status: { lastSentAt: null, problem: null } }),
      ),

    capture: (p) =>
      serial(async () => {
        if (!(await store.get<string>('syncKey'))) return err('notPaired' as const);
        const url = normalizeUrl(p.url);
        if (!url.ok) return err('invalid' as const);
        const itemId = await uuidFromHash(`${CAPTURE_ID_LABEL}|${url.value}|${p.at}`);
        const captured = (await store.get<Captured>('captured')) ?? {};
        const known = captured[url.value];
        // Same url and at: the same capture again, nothing to do.
        if (known && known.itemId === itemId) return ok({ itemId });
        // 008: Log as read on a saved entry marks it read instead of adding a second article.
        if (known && !known.removed && known.saved === true && known.row) {
          const marked = markRead(known, p.readOn, new Date(deps.now()).toISOString() as Instant);
          if (!marked) return err('invalid' as const);
          captured[url.value] = { ...known, saved: false, readOn: p.readOn };
          await stampAndStore(marked, { captured });
          return ok({ itemId: known.itemId });
        }
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

    save: (p) =>
      serial(async () => {
        if (!(await store.get<string>('syncKey'))) return err('notPaired' as const);
        const url = normalizeUrl(p.url);
        if (!url.ok) return err('invalid' as const);
        const itemId = await uuidFromHash(`${CAPTURE_ID_LABEL}|${url.value}|${p.at}|later`);
        const captured = (await store.get<Captured>('captured')) ?? {};
        const known = captured[url.value];
        if (known && known.itemId === itemId) return ok({ itemId });
        if (known && !known.removed && known.saved === true) return ok({ itemId: known.itemId, alreadySaved: true as const });
        const decided = decide(
          null,
          { kind: 'AddArticle', itemId, url: p.url, title: p.title, author: p.author, wordCount: p.words, detailsStatus: p.detailsStatus ?? 'complete' },
          new Date(deps.now()).toISOString() as Instant,
        );
        if (!decided.ok) return err('invalid' as const);
        delete captured[url.value];
        captured[url.value] = { itemId, readOn: '', at: p.at, removed: false, saved: true, row: { ...decided.value.changes[0]!.fields } };
        for (const k of Object.keys(captured).slice(0, Math.max(0, Object.keys(captured).length - MAX_CAPTURED))) delete captured[k];
        await stampAndStore(decided.value.changes, { captured });
        return ok({ itemId });
      }),

    tag: (itemId, names) =>
      serial(async () => {
        if (!(await store.get<string>('syncKey'))) return err('notPaired' as const);
        const captured = (await store.get<Captured>('captured')) ?? {};
        const url = Object.keys(captured).find((u) => captured[u]!.itemId === itemId && !captured[u]!.removed);
        if (url === undefined) return err('invalid' as const);
        const entry = captured[url]!;
        const tagIds = [...(entry.tagIds ?? [])];
        const seen = new Set<string>();
        const changes: Change[] = [];
        let added = 0;
        let dropped = 0;
        for (const raw of names) {
          const name = tagName(raw);
          const key = name.ok ? tagKey(name.value) : null;
          if (!name.ok || key === null || seen.has(key)) {
            dropped++;
            continue;
          }
          seen.add(key);
          // Research R3 step 2: the extension cannot see the tag list, so it uses the derived id.
          const tagId = await uuidFromHash(`${TAG_ID_LABEL}|${key}`);
          if (tagIds.includes(tagId)) continue; // already tagged from here: nothing to add
          const itemTagId = await uuidFromHash(`${ITEM_TAG_ID_LABEL}|${itemId}|${tagId}`);
          const snapshot: TagSnapshot = {
            item: { id: itemId, type: 'article', deletedAt: null },
            tag: null,
            mergeTarget: null,
            assignments: tagIds.map((t) => ({ id: `x-${t}`, itemId, tagId: t, createdAt: '', deletedAt: null })),
            targetAssignments: [],
          } as unknown as TagSnapshot;
          const decided = decide(snapshot, { kind: 'TagArticle', itemId, tagId, itemTagId, name: name.value }, new Date(deps.now()).toISOString() as Instant);
          if (!decided.ok) {
            dropped++;
            continue;
          }
          tagIds.push(tagId);
          changes.push(...decided.value.changes);
          added++;
        }
        if (changes.length > 0) {
          captured[url] = { ...entry, tagIds };
          await stampAndStore(changes, { captured });
        }
        return ok({ added, dropped });
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

    highlight: (p) =>
      serial(async () => {
        if (!(await store.get<string>('syncKey'))) return err('notPaired' as const);
        const captured = (await store.get<Captured>('captured')) ?? {};
        const url = Object.keys(captured).find((u) => captured[u]!.itemId === p.itemId && !captured[u]!.removed);
        if (url === undefined) return err('invalid' as const);
        const highlightId = await uuidFromHash(`${HIGHLIGHT_ID_LABEL}|${url}|${p.at}`);
        const highlights = (await store.get<Highlights>('highlights')) ?? {};
        // 008 FR-006: a highlight on a saved article marks it read first.
        let markChanges: readonly Change[] = [];
        const entry = captured[url]!;
        if (entry.saved === true && entry.row) {
          const marked = markRead(entry, p.localDate, new Date(deps.now()).toISOString() as Instant);
          if (marked) {
            markChanges = marked;
            captured[url] = { ...entry, saved: false, readOn: p.localDate };
          }
        }
        // An empty quote is refused here: the extension only saves selections.
        if (p.quote.trim() === '') return err('invalid' as const);
        const decided = decide(
          highlightSnapshot(p.itemId, highlightId, highlights),
          { kind: 'AddHighlight', highlightId, itemId: p.itemId, quote: p.quote, note: p.note ?? null, localDate: p.localDate },
          new Date(deps.now()).toISOString() as Instant,
        );
        if (!decided.ok) return err(decided.error.kind === 'TooLong' ? ('tooLong' as const) : ('invalid' as const));
        const f = decided.value.changes[0]!.fields;
        highlights[highlightId] = { itemId: p.itemId, quote: f['quote'] as string | null, note: f['note'] as string | null, at: p.at };
        const oldestFirst = Object.keys(highlights).sort((a, b) => highlights[a]!.at.localeCompare(highlights[b]!.at));
        for (const k of oldestFirst.slice(0, Math.max(0, oldestFirst.length - MAX_HIGHLIGHTS))) delete highlights[k];
        await stampAndStore([...markChanges, ...decided.value.changes], { highlights, captured });
        return ok({ highlightId });
      }),

    editNote: (highlightId, note) =>
      serial(async () => {
        const highlights = (await store.get<Highlights>('highlights')) ?? {};
        const h = highlights[highlightId];
        if (!h || h.removed) return err('invalid' as const);
        const decided = decide(highlightSnapshot(h.itemId, highlightId, highlights), { kind: 'EditHighlightNote', highlightId, note }, new Date(deps.now()).toISOString() as Instant);
        if (!decided.ok) return err(decided.error.kind === 'TooLong' ? ('tooLong' as const) : ('invalid' as const));
        if (decided.value.changes.length === 0) return ok(undefined);
        highlights[highlightId] = { ...h, note: decided.value.changes[0]!.fields['note'] as string | null };
        await stampAndStore(decided.value.changes, { highlights });
        return ok(undefined);
      }),

    undoHighlight: (highlightId) =>
      serial(async () => {
        const highlights = (await store.get<Highlights>('highlights')) ?? {};
        const h = highlights[highlightId];
        if (!h || h.removed) return;
        const decided = decide(highlightSnapshot(h.itemId, highlightId, highlights), { kind: 'RemoveHighlight', highlightId }, new Date(deps.now()).toISOString() as Instant);
        if (!decided.ok) return;
        highlights[highlightId] = { ...h, removed: true };
        await stampAndStore(decided.value.changes, { highlights });
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
