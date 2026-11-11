import { parseRemoteOp } from '@especulati/lector-core';
import type { SyncApp } from '@especulati/sync';
import { ENVELOPE_AAD_PREFIX, QR_PREFIX, SYNC_SALT } from './frozen.ts';

/** Lector's sync config: the frozen wire strings and lector's allow-list parser. */
export const lectorSyncApp: SyncApp = {
  salt: SYNC_SALT,
  aadPrefix: ENVELOPE_AAD_PREFIX,
  qrPrefix: QR_PREFIX,
  parseOp: parseRemoteOp,
};
