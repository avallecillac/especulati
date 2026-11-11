import { err, ok, type Result } from './result.ts';

declare const brand: unique symbol;
/** Nominal typing: a value of Brand<T, B> can only be produced by B's parser. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DeviceId = Brand<string, 'DeviceId'>;

export interface ParseError {
  readonly field: string;
  readonly reason: string;
}

export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);

export const parseDeviceId = (s: string): Result<DeviceId, ParseError> =>
  UUID_RE.test(s) ? ok(s as DeviceId) : err({ field: 'deviceId', reason: 'not a lowercase uuid' });
