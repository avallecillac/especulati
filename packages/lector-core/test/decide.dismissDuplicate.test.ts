import { describe, expect, it } from 'vitest';
import { decide } from '../src/index.ts';
import { itemId, NOW, uuid } from './fixtures.ts';

const cmd = (a: string, b: string, id = uuid(77)) => ({ kind: 'DismissDuplicate' as const, dismissalId: id, itemA: a, itemB: b });

describe('decide: DismissDuplicate', () => {
  it('inserts a dismissal with itemA/itemB normalized to min and max', () => {
    for (const [a, b] of [[itemId(1), itemId(2)], [itemId(2), itemId(1)]] as const) {
      expect(decide({ books: [] }, cmd(a, b), NOW)).toEqual({
        ok: true,
        value: { offerFinish: false, changes: [{ tbl: 'duplicate_dismissals', rowId: uuid(77), fields: { item_a: itemId(1), item_b: itemId(2), created_at: NOW } }] },
      });
    }
  });

  it('is idempotent: an existing live dismissal with this id gives no changes', () => {
    const r = decide({ books: [], dismissals: [{ id: uuid(77), deletedAt: null }] }, cmd(itemId(1), itemId(2)), NOW);
    expect(r).toEqual({ ok: true, value: { offerFinish: false, changes: [] } });
  });

  it('rejects malformed ids and identical items with InvalidInput', () => {
    expect(decide({ books: [] }, cmd('x', itemId(2)), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'itemA' } });
    expect(decide({ books: [] }, cmd(itemId(1), 'x'), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'itemB' } });
    expect(decide({ books: [] }, cmd(itemId(1), itemId(2), 'x'), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'dismissalId' } });
    expect(decide({ books: [] }, cmd(itemId(1), itemId(1)), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput' } });
  });
});
