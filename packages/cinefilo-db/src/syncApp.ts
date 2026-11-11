import { parseRemoteOp } from '@especulati/cinefilo-core';
import type { SyncApp } from '@especulati/sync';
import { ENVELOPE_AAD_PREFIX, QR_PREFIX, SYNC_SALT } from './frozen.ts';

/** Cinéfilo's sync config: its frozen wire strings and its allow-list parser (single-tier `tierOf` is in the schema). */
export const cinefiloSyncApp: SyncApp = {
  salt: SYNC_SALT,
  aadPrefix: ENVELOPE_AAD_PREFIX,
  qrPrefix: QR_PREFIX,
  parseOp: parseRemoteOp,
};
