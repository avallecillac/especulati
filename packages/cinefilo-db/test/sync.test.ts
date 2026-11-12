// 4.1: the shared engine over cinefilo's schema, against the in-memory relay.
import { describe, expect, it } from 'vitest';
import { deriveKeys, open, parseSyncCode } from '@especulati/sync';
import { cinefiloSyncApp } from '../src/index.ts';
import { addManual, ANA, BEN, dump, rate, seedMembers } from './helpers.ts';
import { fakeRelay, makePeer, untilQuiet } from './harness.ts';

describe('sync wiring (4.1)', () => {
  it('two databases converge over the relay, and the relay stores only { batchId, iv, ct }', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay, ANA);
    const b = makePeer(2, relay, BEN);
    seedMembers(a, ANA);
    const film = addManual(a, 'Solaris', { year: 1972 });
    rate(a, film, 9, 'slow and wonderful');
    expect((await a.engine.turnOn()).ok).toBe(true);
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    rate(b, film, 2);
    await untilQuiet([a, b]);
    expect(dump(a.raw)).toBe(dump(b.raw));
    expect(b.db.title(film)!.ratings.map((r) => r.stars).sort()).toEqual([2, 9]);

    const keys = await deriveKeys((() => { const k = parseSyncCode(a.engine.showCode()!.code); if (!k.ok) throw new Error('code'); return k.value; })(), cinefiloSyncApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    expect(batches.length).toBeGreaterThan(0);
    for (const e of batches) {
      // `seq` is the relay's own cursor; the rest is the opaque envelope.
      expect(Object.keys(e).sort()).toEqual(['batchId', 'ct', 'iv', 'seq']);
      expect(JSON.stringify(e)).not.toContain('Solaris');
      expect((await open(e, keys.encKey, keys.spaceId, cinefiloSyncApp.aadPrefix)).ok).toBe(true);
    }
    a.close();
    b.close();
  });

  it('the QR text carries the cinefilo prefix', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay, ANA);
    await a.engine.turnOn();
    expect(a.engine.showCode()!.qr.startsWith('cinefilo:sync:1:')).toBe(true);
    a.close();
  });
});
