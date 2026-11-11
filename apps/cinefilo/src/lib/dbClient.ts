import type { Control, Request, Response } from './protocol.ts';

type Pending = (res: Response) => void;

const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
let seq = 0;

// A tab that starts hidden must not grab the DB from the visible one.
worker.postMessage({ kind: 'visibility', visible: document.visibilityState === 'visible' } satisfies Control);
document.addEventListener('visibilitychange', () => {
  worker.postMessage({ kind: 'visibility', visible: document.visibilityState === 'visible' } satisfies Control);
});

worker.onmessage = (ev: MessageEvent<Response>) => {
  const cb = pending.get(ev.data.id);
  pending.delete(ev.data.id);
  cb?.(ev.data);
};

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export function send(req: WithoutId<Request>): Promise<Response> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}

// Typed calls the screens use (group 5+). Every one goes through the worker; the UI never touches SQLite.
import type { Rejection, VerdictFilter, Kind } from '@especulati/cinefilo-core';
import type { ListItem, ListTab, MemberView, TitleDetail } from '@especulati/cinefilo-db';
import type { SyncRunResult, SyncStatusView } from '@especulati/sync';
import type { UiCommand } from './commands.ts';
import type { ClientError, IdentityOp, Query, SyncOp } from './protocol.ts';

export type CallError = ClientError | Rejection;
export type Call<T> = { ok: true; value: T } | { ok: false; error: CallError };

async function call<T>(req: Parameters<typeof send>[0]): Promise<Call<T>> {
  const res = await send(req);
  return res.ok ? { ok: true, value: res.result as T } : { ok: false, error: res.error };
}

const query = <T>(q: Query) => call<T>({ kind: 'query', q });
const sync = <T>(op: SyncOp) => call<T>({ kind: 'sync', op });

export const dispatch = (cmd: UiCommand) => call<{ changes: number }>({ kind: 'dispatch', cmd });

export const list = (tab: ListTab, filter?: VerdictFilter) => query<ListItem[]>({ name: 'list', tab, ...(filter ? { filter } : {}) });
export const title = (id: string) => query<TitleDetail | null>({ name: 'title', id });
export const members = () => query<MemberView[]>({ name: 'members' });
export const me = () => query<{ memberId: string | null; deviceId: string }>({ name: 'me' });
export const findByTmdb = (tmdbId: number, kind: Kind) => query<string | null>({ name: 'findByTmdb', tmdbId, kind });

export type CodeView = { code: string; qr: string };
type SyncResult<T> = { ok: true; value: T } | { ok: false; error: { kind: string; status?: number } };
export const syncRun = (reason: Extract<SyncOp, { action: 'run' }>['reason']) => sync<SyncRunResult>({ action: 'run', reason });
export const syncStatus = () => sync<SyncStatusView>({ action: 'status' });
export const syncTurnOn = () => sync<SyncResult<CodeView>>({ action: 'turnOn' });
export const syncJoin = (code: string) => sync<SyncResult<Record<string, never>>>({ action: 'join', code });
export const syncShowCode = () => sync<CodeView | null>({ action: 'showCode' });
export const syncLeave = () => sync<null>({ action: 'leave' });
export const syncReset = () => sync<SyncResult<CodeView>>({ action: 'reset' });

const identity = <T>(op: IdentityOp) => call<T>({ kind: 'identity', op });
export const startSpace = (name: string) => identity<{ memberId: string; sync: SyncResult<CodeView> }>({ action: 'startSpace', name });
export const createMember = (name: string) => identity<{ memberId: string }>({ action: 'createMember', name });
export const setMe = (memberId: string) => identity<{ memberId: string }>({ action: 'setMe', memberId });

export const exportCatalog = () => call<string>({ kind: 'export' });
export const importCatalog = (text: string) =>
  call<{ ok: true; value: { added: number; present: number } } | { ok: false; error: { field: string; reason: string } }>({ kind: 'import', text });
