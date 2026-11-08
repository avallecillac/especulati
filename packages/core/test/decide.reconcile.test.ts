import { describe, expect, it } from 'vitest';
import {
  decide, tierOf, type Change, type Command, type Highlight, type HighlightId, type Instant, type Item, type ItemId, type ItemTagRow,
  type LocalDate, type ReconcileSnapshot,
} from '../src/index.ts';
import { book, NOW, uuid } from './fixtures.ts';

const S = uuid(50); // survivor (older)
const D = uuid(51); // duplicate (newer)
const URL = 'https://example.com/post';
const OLD = '2026-09-01T10:00:00.000Z' as Instant;
const NEW = '2026-09-05T10:00:00.000Z' as Instant;

const art = (id: string, p: Partial<Item> = {}): Item =>
  book({
    id: id as ItemId, type: 'article', title: 'A Post' as Item['title'], author: 'Ann' as Item['author'], totalPages: null,
    url: URL as Item['url'], domain: 'example.com', wordCount: 1200, readOn: null, createdAt: OLD, ...p,
  });
const hl = (id: string, itemId: string, p: Partial<Highlight> = {}): Highlight => ({
  id: id as HighlightId, itemId: itemId as ItemId, quote: 'q', note: null, page: null, createdAt: NEW,
  localDate: '2026-09-05' as LocalDate, deletedAt: null, ...p,
});
const asg = (id: string, itemId: string, tagId: string, p: Partial<ItemTagRow> = {}): ItemTagRow => ({
  id, itemId, tagId, createdAt: NEW, deletedAt: null, ...p,
});

const snapshot = (p: Partial<ReconcileSnapshot> = {}): ReconcileSnapshot => ({
  survivor: art(S),
  duplicate: art(D, { createdAt: NEW, readOn: '2026-09-05' as LocalDate }),
  duplicateHighlights: [],
  survivorHighlightIds: [],
  duplicateAssignments: [],
  survivorAssignments: [],
  ...p,
});

const cmd = (p: Partial<Extract<Command, { kind: 'ReconcileSavedArticle' }>> = {}): Command => ({
  kind: 'ReconcileSavedArticle', survivorId: S, duplicateId: D, copies: [], tagMoves: [], ...p,
});
const changesOf = (r: ReturnType<typeof decide>): readonly Change[] => {
  if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
  return r.value.changes;
};
const invalid = (r: ReturnType<typeof decide>) => {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe('InvalidInput');
};

describe('ReconcileSavedArticle', () => {
  it('the survivor takes the duplicate read_on with every article insert field (R-2); the duplicate is tombstoned and merged_into', () => {
    const ch = changesOf(decide(snapshot(), cmd(), NOW));
    expect(ch).toEqual([
      {
        tbl: 'items', rowId: S,
        fields: {
          type: 'article', title: 'A Post', url: URL, domain: 'example.com', author: 'Ann', word_count: 1200,
          metadata_status: 'ok', created_at: OLD, read_on: '2026-09-05',
        },
      },
      { tbl: 'items', rowId: D, fields: { deleted_at: NOW, merged_into: S } },
    ]);
    expect(tierOf(ch[0]!.tbl, ch[0]!.fields)).toBe('base'); // read_on is a date: base tier
  });

  it('keeps the survivor read_on when it is already read and the duplicate is saved', () => {
    const ch = changesOf(decide(snapshot({ survivor: art(S, { readOn: '2026-09-02' as LocalDate }), duplicate: art(D, { createdAt: NEW }) }), cmd(), NOW));
    expect(ch[0]!.fields['read_on']).toBe('2026-09-02');
  });

  it('two saved copies merge into the earliest, which stays saved (read_on null, s tier)', () => {
    const ch = changesOf(decide(snapshot({ duplicate: art(D, { createdAt: NEW }) }), cmd(), NOW));
    expect(ch[0]!.fields['read_on']).toBeNull();
    expect('read_on' in ch[0]!.fields).toBe(true);
  });

  it('copies highlights with content-addressed ids, then tombstones the sources', () => {
    const H1 = uuid(70), H2 = uuid(71), C1 = uuid(170), C2 = uuid(171);
    const s = snapshot({ duplicateHighlights: [hl(H1, D, { quote: 'one', note: 'n' }), hl(H2, D, { quote: 'two' }), hl(uuid(72), D, { deletedAt: NEW })] });
    const ch = changesOf(decide(s, cmd({ copies: [{ from: H1, to: C1 }, { from: H2, to: C2 }] }), NOW));
    expect(ch.filter((c) => c.tbl === 'highlights')).toEqual([
      { tbl: 'highlights', rowId: C1, fields: { item_id: S, quote: 'one', note: 'n', page: null, created_at: NEW, local_date: '2026-09-05' } },
      { tbl: 'highlights', rowId: C2, fields: { item_id: S, quote: 'two', note: null, page: null, created_at: NEW, local_date: '2026-09-05' } },
      { tbl: 'highlights', rowId: H1, fields: { deleted_at: NOW } },
      { tbl: 'highlights', rowId: H2, fields: { deleted_at: NOW } },
    ]);
  });

  it('skips a copy already on the survivor and inserts a repeated identical `to` once', () => {
    const H1 = uuid(70), H2 = uuid(71), C1 = uuid(170);
    const s = snapshot({ duplicateHighlights: [hl(H1, D), hl(H2, D)] });
    const once = changesOf(decide(s, cmd({ copies: [{ from: H1, to: C1 }, { from: H2, to: C1 }] }), NOW));
    expect(once.filter((c) => c.tbl === 'highlights' && 'item_id' in c.fields)).toHaveLength(1);
    const there = changesOf(decide({ ...s, survivorHighlightIds: [C1] }, cmd({ copies: [{ from: H1, to: C1 }, { from: H2, to: C1 }] }), NOW));
    expect(there.filter((c) => c.tbl === 'highlights' && 'item_id' in c.fields)).toHaveLength(0);
  });

  it('rejects copies that are not exactly the duplicate live highlights', () => {
    const H1 = uuid(70);
    invalid(decide(snapshot({ duplicateHighlights: [hl(H1, D)] }), cmd({ copies: [] }), NOW));
    invalid(decide(snapshot({ duplicateHighlights: [hl(H1, D)] }), cmd({ copies: [{ from: H1, to: 'bad' }] }), NOW));
    invalid(decide(snapshot(), cmd({ copies: [{ from: H1, to: uuid(170) }] }), NOW));
  });

  it('moves tags: insert, restore, skip live; tombstones the sources', () => {
    const TAG1 = uuid(100), TAG2 = uuid(101), TAG3 = uuid(102);
    const [A1, A2, A3] = [uuid(201), uuid(202), uuid(203)];
    const [B1, B2, B3] = [uuid(301), uuid(302), uuid(303)];
    const s = snapshot({
      duplicateAssignments: [asg(A1, D, TAG1), asg(A2, D, TAG2), asg(A3, D, TAG3), asg(uuid(204), D, uuid(103), { deletedAt: NEW })],
      survivorAssignments: [asg(B2, S, TAG2, { deletedAt: OLD }), asg(B3, S, TAG3)],
    });
    const ch = changesOf(decide(s, cmd({ tagMoves: [{ from: A1, to: B1, itemId: S }, { from: A2, to: B2, itemId: S }, { from: A3, to: B3, itemId: S }] }), NOW));
    expect(ch.filter((c) => c.tbl === 'item_tags')).toEqual([
      { tbl: 'item_tags', rowId: B1, fields: { item_id: S, tag_id: TAG1, created_at: NEW } },
      { tbl: 'item_tags', rowId: B2, fields: { deleted_at: null } },
      { tbl: 'item_tags', rowId: A1, fields: { deleted_at: NOW } },
      { tbl: 'item_tags', rowId: A2, fields: { deleted_at: NOW } },
      { tbl: 'item_tags', rowId: A3, fields: { deleted_at: NOW } },
    ]);
  });

  it('rejects tag moves that are not exactly the duplicate live assignments', () => {
    const s = snapshot({ duplicateAssignments: [asg(uuid(201), D, uuid(100))] });
    invalid(decide(s, cmd({ tagMoves: [] }), NOW));
    invalid(decide(s, cmd({ tagMoves: [{ from: uuid(201), to: uuid(301), itemId: D }] }), NOW)); // itemId must be the survivor
  });

  it('orders the changes survivor, highlights, tags, then the duplicate tombstone last', () => {
    const H1 = uuid(70), A1 = uuid(201);
    const s = snapshot({ duplicateHighlights: [hl(H1, D)], duplicateAssignments: [asg(A1, D, uuid(100))] });
    const ch = changesOf(decide(s, cmd({ copies: [{ from: H1, to: uuid(170) }], tagMoves: [{ from: A1, to: uuid(301), itemId: S }] }), NOW));
    expect(ch[0]).toMatchObject({ tbl: 'items', rowId: S });
    expect(ch[ch.length - 1]).toMatchObject({ tbl: 'items', rowId: D });
  });

  it('InvalidInput unless both are live articles, same URL, survivor older', () => {
    invalid(decide(snapshot({ survivor: null }), cmd(), NOW));
    invalid(decide(snapshot({ duplicate: null }), cmd(), NOW));
    invalid(decide(snapshot({ survivor: art(S, { deletedAt: NEW }) }), cmd(), NOW));
    invalid(decide(snapshot({ duplicate: art(D, { createdAt: NEW, deletedAt: NEW }) }), cmd(), NOW));
    invalid(decide(snapshot({ survivor: book({ id: S as ItemId }) }), cmd(), NOW));
    invalid(decide(snapshot({ duplicate: art(D, { createdAt: NEW, url: 'https://example.com/other' as Item['url'] }) }), cmd(), NOW));
    invalid(decide(snapshot({ survivor: art(S, { createdAt: NEW }), duplicate: art(D, { createdAt: OLD }) }), cmd(), NOW)); // not older
    invalid(decide(snapshot(), cmd({ duplicateId: S }), NOW));
  });

  it('breaks a createdAt tie by id', () => {
    const tie = snapshot({ survivor: art(S, { createdAt: NEW }), duplicate: art(D, { createdAt: NEW }) });
    expect(decide(tie, cmd(), NOW).ok).toBe(true); // S < D
    expect(decide({ ...tie, survivor: art(D, { createdAt: NEW }), duplicate: art(S, { createdAt: NEW }) }, cmd({ survivorId: D, duplicateId: S }), NOW).ok).toBe(false);
  });

  it('rejects two read articles (a re-read is not a duplicate)', () => {
    invalid(decide(snapshot({ survivor: art(S, { readOn: '2026-09-02' as LocalDate }) , duplicate: art(D, { createdAt: NEW, readOn: '2026-09-05' as LocalDate }) }), cmd(), NOW));
  });

  it('R-1: two peers deciding the same reconcile produce deep-equal changes', () => {
    const H1 = uuid(70), A1 = uuid(201);
    const mk = () => snapshot({ duplicateHighlights: [hl(H1, D, { quote: 'x' })], duplicateAssignments: [asg(A1, D, uuid(100))] });
    const c = cmd({ copies: [{ from: H1, to: uuid(170) }], tagMoves: [{ from: A1, to: uuid(301), itemId: S }] });
    expect(decide(mk(), c, NOW)).toEqual(decide(mk(), c, NOW));
    // reconciling twice, the second time against the applied result, is a no-op beyond tombstones
    expect(changesOf(decide(mk(), c, NOW))).toEqual(changesOf(decide(mk(), c, NOW)));
  });
});
