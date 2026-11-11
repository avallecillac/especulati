import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dismissalId, mergeCopyId, uuidFromHash } from './ids.ts';

/** Independent reference implementation with node:crypto. */
function reference(label: string): string {
  const b = createHash('sha256').update(label).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

describe('ids', () => {
  it('uuidFromHash matches the node:crypto reference and is a v4-shaped lowercase uuid', async () => {
    for (const label of ['', 'a', 'readerlog-merge-v1|x|y', 'ñandú ☃']) {
      const id = await uuidFromHash(label);
      expect(id).toBe(reference(label));
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('has fixed vectors', async () => {
    // SHA-256("") = e3b0c442 98fc1c14 9afbf4c8 996fb924 ...
    expect(await uuidFromHash('')).toBe('e3b0c442-98fc-4c14-9afb-f4c8996fb924');
  });

  it('mergeCopyId hashes the documented label', async () => {
    const e = { type: 'progress', page: 42, occurredAt: '2026-09-01T10:00:00.000Z', localDate: '2026-09-01' };
    expect(await mergeCopyId(A, e)).toBe(reference(`readerlog-merge-v2|${A}|progress|42|2026-09-01T10:00:00.000Z|2026-09-01`));
    expect(await mergeCopyId(A, { ...e, page: null })).toBe(reference(`readerlog-merge-v2|${A}|progress||2026-09-01T10:00:00.000Z|2026-09-01`));
    expect(await mergeCopyId(A, e)).not.toBe(await mergeCopyId(B, e));
    expect(await mergeCopyId(A, e)).toBe('c22c4e0b-f9a8-42bc-bae4-e760ee4f78f4');
  });

  it('dismissalId is order-independent', async () => {
    expect(await dismissalId(A, B)).toBe(await dismissalId(B, A));
    expect(await dismissalId(B, A)).toBe(reference(`readerlog-dismiss-v1|${A}|${B}`));
  });
});
