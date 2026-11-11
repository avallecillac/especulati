import { describe, expect, it } from 'vitest';
import type { OpWire } from '@especulati/sync-core';
import { pushAll, PUSH_LIMIT, type PushDeps, type PushSource } from '../src/push.ts';
import type { RelayResult } from '../src/relayClient.ts';
import { fakeRelay, makeToyPeer } from './toyHarness.ts';

const op = (i: number) => ({ i }) as unknown as OpWire;

/** A capture-peer-style source: an in-memory array, tokens are counts. */
function memorySource(n: number, log: string[] = []) {
  const state = { ops: Array.from({ length: n }, (_, i) => op(i)), pending: null as { batchId: string; token: number } | null };
  const source: PushSource<number> = {
    next(limit, upTo) {
      const ops = state.ops.slice(0, Math.min(limit, upTo ?? Infinity));
      return { ops, token: ops.length };
    },
    complete(token) {
      log.push('complete');
      state.ops.splice(0, token);
    },
    pending: () => state.pending,
    setPending(p) {
      log.push('setPending');
      state.pending = p;
    },
  };
  return { state, source };
}

function harness(replies: Array<RelayResult<{ seq: number; duplicate: boolean }>>, log: string[]) {
  const posted: Array<{ batchId: string; n: number }> = [];
  let ids = 0;
  const deps: PushDeps = {
    client: {
      postBatch(e) {
        log.push('post');
        posted.push({ batchId: e.batchId, n: Number(e.ct) });
        return Promise.resolve(replies.shift() ?? { ok: true, value: { seq: 1, duplicate: false } });
      },
    },
    seal: (ops, batchId) => Promise.resolve({ batchId, iv: '', ct: String(ops.length) }),
    newBatchId: () => `id-${++ids}`,
  };
  return { deps, posted };
}

describe('pushAll', () => {
  it('batches at 500', async () => {
    const log: string[] = [];
    const { state, source } = memorySource(1200, log);
    const { deps, posted } = harness([], log);
    const out = await pushAll(source, deps);
    expect(posted.map((p) => p.n)).toEqual([PUSH_LIMIT, PUSH_LIMIT, 200]);
    expect(new Set(posted.map((p) => p.batchId)).size).toBe(3);
    expect(out).toEqual({ pushed: 1200, failure: null });
    expect(state.ops).toHaveLength(0);
  });

  it('persists the pending batch before the POST, and completes only after it', async () => {
    const log: string[] = [];
    const { source } = memorySource(3, log);
    const { deps } = harness([], log);
    await pushAll(source, deps);
    expect(log).toEqual(['setPending', 'post', 'complete']);
  });

  it('does not complete after a failed POST, and resends the same batchId after a crash', async () => {
    const log: string[] = [];
    const { state, source } = memorySource(3, log);
    const first = harness([{ ok: false, kind: 'offline' }], log);
    const out = await pushAll(source, first.deps);
    expect(out.pushed).toBe(0);
    expect(out.failure).toMatchObject({ kind: 'offline' });
    expect(state.ops).toHaveLength(3);
    const id = first.posted[0]!.batchId;
    expect(state.pending?.batchId).toBe(id);

    // New ops arrive while the batch is pending: the resend must not grow.
    state.ops.push(op(3));
    const second = harness([], log);
    const out2 = await pushAll(source, second.deps);
    expect(second.posted[0]).toEqual({ batchId: id, n: 3 });
    expect(out2.failure).toBeNull();
    expect(out2.pushed).toBe(4);
    expect(state.ops).toHaveLength(0);
  });

  it('accepts duplicate:true as success', async () => {
    const log: string[] = [];
    const { state, source } = memorySource(2, log);
    const { deps } = harness([{ ok: true, value: { seq: 9, duplicate: true } }], log);
    const out = await pushAll(source, deps);
    expect(out).toEqual({ pushed: 2, failure: null });
    expect(state.ops).toHaveLength(0);
  });
});

describe('pushAll over the store source: batch tiers (toy schema)', () => {
  /** The push source the engine builds over a SyncStore: the token is the change_log seq. */
  function storeSource(t: ReturnType<typeof makeToyPeer>): PushSource<number> {
    return {
      next: (limit, upTo) => {
        const { maxSeq, ops } = t.store.unpushedOps(limit, upTo);
        return { ops, token: maxSeq };
      },
      complete: (token) => t.store.completePush(token),
      pending: () => {
        const p = t.store.syncMeta().pendingBatch;
        return p ? { batchId: p.batchId, token: p.maxSeq } : null;
      },
      setPending: (p) => t.store.setSyncMeta({ pendingBatch: p ? { batchId: p.batchId, maxSeq: p.token } : null }),
    };
  }

  function sink() {
    const sent: string[][] = [];
    let ids = 0;
    const deps: PushDeps = {
      client: { postBatch: () => Promise.resolve({ ok: true, value: { seq: 1, duplicate: false } }) },
      seal: (ops, batchId) => {
        sent.push(ops.map((o) => o.tbl));
        return Promise.resolve({ batchId, iv: '', ct: '' });
      },
      newBatchId: () => `id-${++ids}`,
    };
    return { sent, deps };
  }

  it('[notes, marks, marks, notes] goes out as three single-tier batches, in order', async () => {
    const t = makeToyPeer(1, fakeRelay());
    const n1 = t.addNote('One');
    t.addMark(n1, 'a');
    t.addMark(n1, 'b');
    t.addNote('Two');
    const logged = t.raw.selectValues('SELECT tbl FROM change_log ORDER BY seq').map(String);
    expect(logged).toEqual(['notes', 'marks', 'marks', 'notes']);

    const { sent, deps } = sink();
    const out = await pushAll(storeSource(t), deps);
    expect(sent).toEqual([['notes'], ['marks', 'marks'], ['notes']]);
    expect(out).toEqual({ pushed: 4, failure: null });
    expect(t.store.pendingCount()).toBe(0);
  });

  it('a re-sent pending batch carries the same single-tier content', () => {
    const t = makeToyPeer(1, fakeRelay());
    const n1 = t.addNote('One');
    t.addMark(n1, 'a');
    const first = t.store.unpushedOps(500);
    expect(first.ops.map((o) => o.tbl)).toEqual(['notes']);
    const again = t.store.unpushedOps(500, first.maxSeq);
    expect(again.ops.map((o) => o.tbl)).toEqual(['notes']);
    expect(again.maxSeq).toBe(first.maxSeq);
  });
});
