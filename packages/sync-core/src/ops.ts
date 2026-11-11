import { hlcNext, type Hlc } from './hlc.ts';
import type { DeviceId } from './ids.ts';
import type { Change, OpWire } from './merge.ts';

/**
 * Turn decided changes into wire ops with the same stamping rule as the DB's `applyChanges`: one
 * HLC per change, each `hlcNext` of the previous. For a peer that has no SQLite (005 R7).
 * `hlc` in the result is the last stamp issued, or the given one if there were no changes.
 */
export function stampOps(
  changes: readonly Change[],
  s: { hlc: Hlc | null; deviceId: DeviceId; wallMs: number; newOpId: () => string },
): { ops: OpWire[]; hlc: Hlc | null } {
  let hlc = s.hlc;
  const ops: OpWire[] = [];
  for (const c of changes) {
    hlc = hlcNext(hlc, s.wallMs, s.deviceId);
    ops.push({ op: s.newOpId(), hlc, tbl: c.tbl, row: c.rowId, fields: { ...c.fields } });
  }
  return { ops, hlc };
}
