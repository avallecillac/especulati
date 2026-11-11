import type { Kind, Rejection, VerdictFilter } from '@especulati/cinefilo-core';
import type { ListScope, ListTab } from '@especulati/cinefilo-db';
import type { SyncReason } from '@especulati/sync';
import type { UiCommand } from './commands.ts';

export type Query =
  | { name: 'list'; tab: ListTab; filter?: VerdictFilter; scope?: ListScope }
  /** Open recommendations to this device's member (personal-lists D5: shown atop their Watch later). */
  | { name: 'pendingRecommendations' }
  | { name: 'title'; id: string }
  | { name: 'members' }
  | { name: 'me' }
  | { name: 'findByTmdb'; tmdbId: number; kind: Kind }
  | { name: 'needsDetails'; limit: number };

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
  /** A `cinefilo-titles/v1` list: `dryRun` previews (counts, reasons) without writing. */
  | { kind: 'importTitles'; text: string; dryRun: boolean }
  /** Leave: stop sync and wipe this device's database. The next request opens a fresh one. */
  | { kind: 'erase' }
  /** The TMDB key lives in `meta` (device-local, never synced or exported). `set` with '' removes it. */
  | { kind: 'tmdbKey'; op: { action: 'get' } | { action: 'set'; key: string } }
  /** The local poster cache. `store` downscales in the worker (the shell downloads, like lector's covers). */
  | { kind: 'poster'; op: { action: 'get'; titleId: string } | { action: 'store'; titleId: string; image: Blob } }
);
export type Control = { kind: 'visibility'; visible: boolean };
export type ClientError = { kind: 'Busy' } | { kind: 'Storage'; message: string };
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError | Rejection };
