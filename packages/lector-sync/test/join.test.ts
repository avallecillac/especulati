// The engine's join() no longer counts duplicates (design decision 5): the lector worker reads
// them from LectorDb afterwards. This keeps the US5 behaviour pinned for lector peers.
import { describe, expect, it } from 'vitest';
import { fakeRelay, makePeer, uuid } from './harness.ts';

describe('lector join', () => {
  it('returns an empty ok; the duplicate pairs after the merge of both logs come from LectorDb (US5)', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    const b = makePeer(2, relay);
    for (const [p, n] of [[a, 0x610001], [b, 0x610002]] as const) {
      p.tick();
      expect(p.db.dispatch({ kind: 'AddBook', itemId: uuid(n), title: 'Dune', isbn: '9780306406157', startNow: false, localDate: '2026-09-01' }, p.env).ok).toBe(true);
    }
    await a.engine.turnOn();
    const r = await b.engine.join(a.engine.showCode()!.code);
    expect(r).toEqual({ ok: true, value: {} });
    expect(b.db.duplicates()).toHaveLength(1);
  });
});
