import type { OpWire, ParseError, RemoteOp, Result } from '@especulati/sync-core';

/**
 * What an app tells the sync code about itself. The three strings keep one app's sync space,
 * ciphertext and QR codes from being valid for another: they are wire identifiers, so an app must
 * never change them once devices exist. `parseOp` is the app's allow-list parser for untrusted ops.
 */
export interface SyncApp {
  /** HKDF salt. */
  salt: string;
  /** AES-GCM additional-data prefix: the AAD is `${aadPrefix}/${spaceId}/${batchId}`. */
  aadPrefix: string;
  /** Text in front of a QR payload. */
  qrPrefix: string;
  parseOp: (w: OpWire, device: string) => Result<RemoteOp, ParseError>;
}
