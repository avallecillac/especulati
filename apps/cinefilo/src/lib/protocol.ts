import type { Kind, Rejection, VerdictFilter } from '@especulati/cinefilo-core';
import type { ListTab } from '@especulati/cinefilo-db';
import type { SyncReason } from '@especulati/sync';
import type { UiCommand } from './commands.ts';

export type Query =
  | { name: 'list'; tab: ListTab; filter?: VerdictFilter }
  | { name: 'title'; id: string }
  | { name: 'members' }
  | { name: 'me' }
  | { name: 'findByTmdb'; tmdbId: number; kind: Kind };

export type SyncOp =
  | { action: 'run'; reason: SyncReason }
  | { action: 'status' }
  | { action: 'turnOn' }
  | { action: 'join'; code: string }
  | { action: 'showCode' }
  | { action: 'leave' }
  | { action: 'reset' };

/** Who this device is. `startSpace` makes the first member and turns sync on; `createMember` is "I'm new". */
export type IdentityOp =
  | { action: 'startSpace'; name: string }
  | { action: 'createMember'; name: string }
  | { action: 'setMe'; memberId: string };

/** UI ↔ DB worker messages. */
export type Request = { id: number } & (
  | { kind: 'ping' }
  | { kind: 'dispatch'; cmd: UiCommand }
  | { kind: 'query'; q: Query }
  | { kind: 'sync'; op: SyncOp }
  | { kind: 'identity'; op: IdentityOp }
  | { kind: 'export' }
  | { kind: 'import'; text: string }
  /** Leave: stop sync and wipe this device's database. The next request opens a fresh one. */
  | { kind: 'erase' }
);
export type Control = { kind: 'visibility'; visible: boolean };
export type ClientError = { kind: 'Busy' } | { kind: 'Storage'; message: string };
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError | Rejection };
