// The lector tiers (007, contracts/sync-tiers.md) pushed through pushAll over a LectorDb's sync store.
import { describe, expect, it } from 'vitest';
import { pushAll, type PushDeps, type PushSource } from '@especulati/sync';
import { openTestDb, uuid } from '../../lector-db/test/helpers.ts';

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
