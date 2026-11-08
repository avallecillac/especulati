import { describe, expect, it } from 'vitest';
import {
  decide, tagKey, TAGS_PER_ARTICLE_MAX, type Change, type Command, type Instant, type ItemTagRow, type TagRow, type TagSnapshot,
} from '../src/index.ts';
import { NOW, uuid } from './fixtures.ts';

const ITEM = uuid(50);
const T_AI = uuid(100);
const IT_AI = uuid(200);
const EARLIER = '2026-09-01T10:00:00.000Z' as Instant;

const item = (p: Partial<NonNullable<TagSnapshot['item']>> = {}): NonNullable<TagSnapshot['item']> => ({
  id: ITEM as never, type: 'article', deletedAt: null, ...p,
});
const tag = (id: string, name: string, p: Partial<TagRow> = {}): TagRow => ({ id, name, nameKey: tagKey(name)!, deletedAt: null, ...p });
const asg = (id: string, itemId: string, tagId: string, p: Partial<ItemTagRow> = {}): ItemTagRow => ({
  id, itemId, tagId, createdAt: EARLIER, deletedAt: null, ...p,
});
const snapOf = (p: Partial<TagSnapshot> = {}): TagSnapshot => ({
  item: item(), tag: null, mergeTarget: null, assignments: [], targetAssignments: [], ...p,
});
const changesOf = (r: ReturnType<typeof decide>): readonly Change[] => {
  if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
  return r.value.changes;
};
const tagCmd = (p: Partial<Extract<Command, { kind: 'TagArticle' }>> = {}): Command => ({
  kind: 'TagArticle', itemId: ITEM, tagId: T_AI, itemTagId: IT_AI, name: '  AI ', ...p,
});

describe('TagArticle', () => {
  it('inserts the tag and the assignment for a new tag', () => {
    expect(changesOf(decide(snapOf(), tagCmd(), NOW))).toEqual([
      { tbl: 'tags', rowId: T_AI, fields: { name: 'AI', name_key: 'ai', created_at: NOW } },
      { tbl: 'item_tags', rowId: IT_AI, fields: { item_id: ITEM, tag_id: T_AI, created_at: NOW } },
    ]);
  });
  it('inserts only the assignment for an existing tag', () => {
    expect(changesOf(decide(snapOf({ tag: tag(T_AI, 'AI') }), tagCmd(), NOW))).toEqual([
      { tbl: 'item_tags', rowId: IT_AI, fields: { item_id: ITEM, tag_id: T_AI, created_at: NOW } },
    ]);
  });
  it('restores a tombstoned tag and a tombstoned assignment', () => {
    const s = snapOf({ tag: tag(T_AI, 'old', { deletedAt: EARLIER }), assignments: [asg(IT_AI, ITEM, T_AI, { deletedAt: EARLIER })] });
    expect(changesOf(decide(s, tagCmd(), NOW))).toEqual([
      { tbl: 'tags', rowId: T_AI, fields: { name: 'AI', name_key: 'ai', deleted_at: null } },
      { tbl: 'item_tags', rowId: IT_AI, fields: { deleted_at: null } },
    ]);
  });
  it('gives no changes when already tagged', () => {
    const s = snapOf({ tag: tag(T_AI, 'AI'), assignments: [asg(IT_AI, ITEM, T_AI)] });
    expect(changesOf(decide(s, tagCmd(), NOW))).toEqual([]);
  });
  it('rejects the 21st tag with TooManyTags', () => {
    const others = Array.from({ length: TAGS_PER_ARTICLE_MAX }, (_, i) => asg(uuid(300 + i), ITEM, uuid(400 + i)));
    expect(decide(snapOf({ assignments: others }), tagCmd(), NOW)).toEqual({ ok: false, error: { kind: 'TooManyTags', max: 20 } });
    // the 20th is fine
    expect(decide(snapOf({ assignments: others.slice(1) }), tagCmd(), NOW).ok).toBe(true);
  });
  it('does not count removed assignments toward the limit', () => {
    const others = Array.from({ length: 25 }, (_, i) => asg(uuid(300 + i), ITEM, uuid(400 + i), { deletedAt: EARLIER }));
    expect(decide(snapOf({ assignments: others }), tagCmd(), NOW).ok).toBe(true);
  });
  it('NotFound for a book, a removed item, or no item', () => {
    expect(decide(snapOf({ item: item({ type: 'book' }) }), tagCmd(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snapOf({ item: item({ deletedAt: NOW }) }), tagCmd(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snapOf({ item: null }), tagCmd(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
  it('InvalidInput for an empty or 41-character name', () => {
    for (const name of ['   ', 'x'.repeat(41)]) {
      const r = decide(snapOf(), tagCmd({ name }), NOW);
      expect(r).toEqual({ ok: false, error: { kind: 'InvalidInput', field: 'name', reason: expect.any(String) } });
    }
  });
  it('InvalidInput for a malformed id', () => {
    const r = decide(snapOf(), tagCmd({ tagId: 'nope' }), NOW);
    expect(r.ok).toBe(false);
  });
});

describe('UntagArticle', () => {
  const cmd: Command = { kind: 'UntagArticle', itemTagId: IT_AI };
  it('tombstones the assignment, idempotently', () => {
    const live = snapOf({ assignments: [asg(IT_AI, ITEM, T_AI)] });
    expect(changesOf(decide(live, cmd, NOW))).toEqual([{ tbl: 'item_tags', rowId: IT_AI, fields: { deleted_at: NOW } }]);
    const gone = snapOf({ assignments: [asg(IT_AI, ITEM, T_AI, { deletedAt: EARLIER })] });
    expect(changesOf(decide(gone, cmd, NOW))).toEqual([]);
  });
  it('NotFound for an unknown assignment', () => {
    expect(decide(snapOf(), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('RenameTag', () => {
  const T_SRC = uuid(101);
  const T_DST = uuid(102);
  const rename = (p: Partial<Extract<Command, { kind: 'RenameTag' }>> = {}): Command => ({ kind: 'RenameTag', tagId: T_SRC, newName: 'Machine Learning', ...p });

  it('a plain rename sets name and name_key', () => {
    const s = snapOf({ tag: tag(T_SRC, 'ml') });
    expect(changesOf(decide(s, rename(), NOW))).toEqual([
      { tbl: 'tags', rowId: T_SRC, fields: { name: 'Machine Learning', name_key: 'machine learning' } },
    ]);
  });
  it('renaming to the same name changes nothing', () => {
    expect(changesOf(decide(snapOf({ tag: tag(T_SRC, 'ml') }), rename({ newName: 'ml' }), NOW))).toEqual([]);
  });
  it('NotFound for a missing or removed tag; InvalidInput for a bad name', () => {
    expect(decide(snapOf(), rename(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snapOf({ tag: tag(T_SRC, 'ml', { deletedAt: EARLIER }) }), rename(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    const r = decide(snapOf({ tag: tag(T_SRC, 'ml') }), rename({ newName: '' }), NOW);
    expect(r).toEqual({ ok: false, error: { kind: 'InvalidInput', field: 'name', reason: expect.any(String) } });
  });

  describe('merge', () => {
    const A1 = uuid(501);
    const A2 = uuid(502);
    const I1 = uuid(61);
    const I2 = uuid(62);
    const T1 = uuid(601); // derived target assignment for I1 (not existing)
    const T2 = uuid(602); // derived target assignment for I2 (existing, tombstoned)
    const mergeSnap = () => snapOf({
      tag: tag(T_SRC, 'ml'),
      mergeTarget: tag(T_DST, 'Machine Learning'),
      assignments: [asg(A1, I1, T_SRC), asg(A2, I2, T_SRC), asg(uuid(503), I1, T_SRC, { deletedAt: EARLIER })],
      targetAssignments: [asg(T2, I2, T_DST, { deletedAt: EARLIER })],
    });
    const mergeCmd = (p: { moves?: { from: string; to: string; itemId: string }[] } = {}): Command =>
      rename({
        merge: {
          targetTagId: T_DST,
          moves: p.moves ?? [{ from: A1, to: T1, itemId: I1 }, { from: A2, to: T2, itemId: I2 }],
        },
      });

    it('inserts or restores each to, then tombstones each from (by from id), then the source', () => {
      expect(changesOf(decide(mergeSnap(), mergeCmd(), NOW))).toEqual([
        { tbl: 'item_tags', rowId: T1, fields: { item_id: I1, tag_id: T_DST, created_at: EARLIER } },
        { tbl: 'item_tags', rowId: T2, fields: { deleted_at: null } },
        { tbl: 'item_tags', rowId: A1, fields: { deleted_at: NOW } },
        { tbl: 'item_tags', rowId: A2, fields: { deleted_at: NOW } },
        { tbl: 'tags', rowId: T_SRC, fields: { deleted_at: NOW } },
      ]);
    });
    it('skips the insert when the target assignment is already live', () => {
      const s = { ...mergeSnap(), targetAssignments: [asg(T1, I1, T_DST), asg(T2, I2, T_DST)] };
      const ch = changesOf(decide(s, mergeCmd(), NOW));
      expect(ch.map((c) => [c.rowId, c.fields['deleted_at'] ?? 'x'])).toEqual([[A1, NOW], [A2, NOW], [T_SRC, NOW]]);
    });
    it('rejects moves that do not equal the source live assignments', () => {
      const bad = (moves: { from: string; to: string; itemId: string }[]) =>
        expect(decide(mergeSnap(), mergeCmd({ moves }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidInput', field: 'merge', reason: expect.any(String) } });
      bad([{ from: A1, to: T1, itemId: I1 }]); // missing one
      bad([{ from: A1, to: T1, itemId: I1 }, { from: A2, to: T2, itemId: I2 }, { from: uuid(503), to: uuid(603), itemId: I1 }]); // removed one included
      bad([{ from: A1, to: T1, itemId: I2 }, { from: A2, to: T2, itemId: I2 }]); // wrong item
    });
    it('rejects a target that is missing, removed, the source, or has another key', () => {
      const m = mergeCmd();
      const bad = (s: TagSnapshot) => expect(decide(s, m, NOW)).toEqual({ ok: false, error: { kind: 'InvalidInput', field: 'merge', reason: expect.any(String) } });
      bad({ ...mergeSnap(), mergeTarget: null });
      bad({ ...mergeSnap(), mergeTarget: tag(T_DST, 'Machine Learning', { deletedAt: EARLIER }) });
      bad({ ...mergeSnap(), mergeTarget: tag(T_DST, 'Something else') });
    });
  });
});

describe('DeleteTag', () => {
  const T_SRC = uuid(101);
  it('tombstones the tag and every live assignment', () => {
    const s = snapOf({
      tag: tag(T_SRC, 'ml'),
      assignments: [asg(uuid(501), uuid(61), T_SRC), asg(uuid(502), uuid(62), T_SRC, { deletedAt: EARLIER }), asg(uuid(503), uuid(63), T_SRC)],
    });
    expect(changesOf(decide(s, { kind: 'DeleteTag', tagId: T_SRC }, NOW))).toEqual([
      { tbl: 'item_tags', rowId: uuid(501), fields: { deleted_at: NOW } },
      { tbl: 'item_tags', rowId: uuid(503), fields: { deleted_at: NOW } },
      { tbl: 'tags', rowId: T_SRC, fields: { deleted_at: NOW } },
    ]);
  });
  it('NotFound for an unknown tag', () => {
    expect(decide(snapOf(), { kind: 'DeleteTag', tagId: T_SRC }, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});
