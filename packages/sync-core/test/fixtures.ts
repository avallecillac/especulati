import type { DeviceId } from '../src/index.ts';

/** Deterministic lowercase v4-shaped UUIDs: uuid(1) → 00000000-0000-4000-8000-000000000001 */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const deviceId = (n = 1) => uuid(9000 + n) as DeviceId;
