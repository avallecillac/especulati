import { describe, expect, it } from 'vitest';
import type { OpWire } from '@readerlog/core';
import { pushAll, PUSH_LIMIT, type PushDeps, type PushSource } from '../src/push.ts';
import type { RelayResult } from '../src/relayClient.ts';
import { openTestDb, uuid } from '../../db/test/helpers.ts';

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

describe('pushAll over the db source: batch tiers (007, contracts/sync-tiers.md)', () => {
  it('[items, highlights, highlights, reading_events] goes out as three single-tier batches, in order', async () => {
    const t = openTestDb();
    t.tick();
    expect(t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env).ok).toBe(true);
    for (const n of [0x30, 0x31]) {
      t.tick();
      expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(n), itemId: uuid(1), quote: `Passage ${n}`, localDate: '2026-09-01' }, t.env).ok).toBe(true);
    }
    t.tick();
    expect(t.db.dispatch({ kind: 'LogEvent', itemId: uuid(1), eventId: uuid(0x40), type: 'progress', page: 5, localDate: '2026-09-02' }, t.env).ok).toBe(true);
    const logged = t.raw.selectValues('SELECT tbl FROM change_log ORDER BY seq').map(String);
    expect(logged).toEqual(['items', 'highlights', 'highlights', 'reading_events']);

    const source: PushSource<number> = {
      next: (limit, upTo) => {
        const { maxSeq, ops } = t.db.unpushedOps(limit, upTo);
        return { ops, token: maxSeq };
      },
      complete: (token) => t.db.completePush(token),
      pending: () => {
        const p = t.db.syncMeta().pendingBatch;
        return p ? { batchId: p.batchId, token: p.maxSeq } : null;
      },
      setPending: (p) => t.db.setSyncMeta({ pendingBatch: p ? { batchId: p.batchId, maxSeq: p.token } : null }),
    };
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
    const out = await pushAll(source, deps);
    expect(sent).toEqual([['items'], ['highlights', 'highlights'], ['reading_events']]);
    expect(out).toEqual({ pushed: 4, failure: null });
    expect(t.db.pendingCount()).toBe(0);
  });

  it('[items(read), tags, item_tags, items(read_on:null), highlights, items(read)] goes out as 5 single-tier batches, in order (008)', async () => {
    const t = openTestDb();
    const run = (cmd: Parameters<typeof t.db.dispatch>[0]) => { t.tick(); expect(t.db.dispatch(cmd, t.env)).toMatchObject({ ok: true }); };
    run({ kind: 'AddArticle', itemId: uuid(1), url: 'https://a.example/1', title: 'One', author: null, wordCount: 100, readOn: '2026-09-01', detailsStatus: 'complete' });
    run({ kind: 'TagArticle', itemId: uuid(1), tagId: uuid(0x50), itemTagId: uuid(0x51), name: 'ai' });
    run({ kind: 'MarkArticleUnread', itemId: uuid(1) });
    run({ kind: 'AddHighlight', highlightId: uuid(0x30), itemId: uuid(1), quote: 'Passage', localDate: '2026-09-01' });
    run({ kind: 'MarkArticleRead', itemId: uuid(1), readOn: '2026-09-02' });
    const logged = t.raw.selectValues('SELECT tbl FROM change_log ORDER BY seq').map(String);
    expect(logged).toEqual(['items', 'tags', 'item_tags', 'items', 'highlights', 'items']);

    const source: PushSource<number> = {
      next: (limit, upTo) => {
        const { maxSeq, ops } = t.db.unpushedOps(limit, upTo);
        return { ops, token: maxSeq };
      },
      complete: (token) => t.db.completePush(token),
      pending: () => {
        const p = t.db.syncMeta().pendingBatch;
        return p ? { batchId: p.batchId, token: p.maxSeq } : null;
      },
      setPending: (p) => t.db.setSyncMeta({ pendingBatch: p ? { batchId: p.batchId, maxSeq: p.token } : null }),
    };
    const sent: string[][] = [];
    let ids = 0;
    const deps: PushDeps = {
      client: { postBatch: () => Promise.resolve({ ok: true, value: { seq: 1, duplicate: false } }) },
      seal: (ops, batchId) => {
        sent.push(ops.map((o) => `${o.tbl}${o.tbl === 'items' ? (Object.prototype.hasOwnProperty.call(o.fields, 'read_on') && o.fields['read_on'] === null ? ':saved' : ':read') : ''}`));
        return Promise.resolve({ batchId, iv: '', ct: '' });
      },
      newBatchId: () => `id-${++ids}`,
    };
    const out = await pushAll(source, deps);
    expect(sent).toEqual([['items:read'], ['tags', 'item_tags'], ['items:saved'], ['highlights'], ['items:read']]);
    expect(out).toEqual({ pushed: 6, failure: null });
    expect(t.db.pendingCount()).toBe(0);
  });

  it('a re-sent pending batch carries the same single-tier content', () => {
    const t = openTestDb();
    t.tick();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x30), itemId: uuid(1), quote: 'Passage', localDate: '2026-09-01' }, t.env);
    const first = t.db.unpushedOps(500);
    expect(first.ops.map((o) => o.tbl)).toEqual(['items']);
    const again = t.db.unpushedOps(500, first.maxSeq);
    expect(again.ops.map((o) => o.tbl)).toEqual(['items']);
    expect(again.maxSeq).toBe(first.maxSeq);
  });

  it('a re-send up to a seq returns every unpushed op up to it, so completing it never skips one', () => {
    const t = openTestDb();
    t.tick();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(1), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    t.tick();
    t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x30), itemId: uuid(1), quote: 'Passage', localDate: '2026-09-01' }, t.env);
    const maxSeq = Number(t.raw.selectValue('SELECT MAX(seq) FROM change_log'));
    const resend = t.db.unpushedOps(500, maxSeq);
    expect(resend.ops.map((o) => o.tbl)).toEqual(['items', 'highlights']);
    expect(resend.maxSeq).toBe(maxSeq);
  });
});
