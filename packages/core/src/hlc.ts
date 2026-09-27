import { err, ok, type Result } from './result.ts';
import { UUID_PATTERN, type Brand, type DeviceId, type ParseError } from './types.ts';

/**
 * Hybrid logical clock stamp: `<13-digit unix ms>-<4-digit counter>-<device uuid>`.
 * Fixed-width fields make plain string comparison equal causal order.
 */
export type Hlc = Brand<string, 'Hlc'>;

const HLC_RE = new RegExp(`^(\\d{13})-(\\d{4})-(${UUID_PATTERN})$`);
const MAX_COUNTER = 9999;

export function parseHlc(input: string): Result<{ ms: number; counter: number; deviceId: DeviceId }, ParseError> {
  const m = HLC_RE.exec(input);
  if (!m) return err({ field: 'hlc', reason: 'malformed hlc' });
  return ok({ ms: Number(m[1]), counter: Number(m[2]), deviceId: m[3] as DeviceId });
}

const format = (ms: number, counter: number, deviceId: DeviceId): Hlc =>
  `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-${deviceId}` as Hlc;

/** Next stamp for a local event. Monotonic even if the wall clock stalls or goes backwards. */
export function hlcNext(prev: Hlc | null, wallMs: number, deviceId: DeviceId): Hlc {
  if (prev === null) return format(wallMs, 0, deviceId);
  const p = parseHlc(prev);
  if (!p.ok) throw new Error(`corrupt hlc state: ${prev}`);
  const { ms, counter } = p.value;
  if (wallMs > ms) return format(wallMs, 0, deviceId);
  return counter < MAX_COUNTER ? format(ms, counter + 1, deviceId) : format(ms + 1, 0, deviceId);
}

export const compareHlc = (a: Hlc, b: Hlc): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
