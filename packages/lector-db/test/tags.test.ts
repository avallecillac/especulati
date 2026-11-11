import { describe, expect, it } from 'vitest';
import { tagKey } from '@especulati/lector-core';
import { hashIdAsync, itemTagIdOf, openTestDb, tagIdOf, uuid, type TestDb } from './helpers.ts';

function article(t: TestDb, n: number, readOn?: string) {
  t.tick();
  expect(t.db.dispatch({ kind: 'AddArticle', itemId: uuid(n), url: `https://www.example.com/a${n}`, title: `Article ${n}`, author: null, wordCount: 476, ...(readOn ? { readOn } : {}), detailsStatus: 'complete' }, t.env)).toMatchObject({ ok: true });
}
/** What the shell does: resolve the tag id, derive the assignment id, dispatch TagArticle. */
async function tag(t: TestDb, item: number, name: string) {
  t.tick();
  const tagId = (await t.db.resolveTagId(name, hashIdAsync))!;
  const r = t.db.dispatch({ kind: 'TagArticle', itemId: uuid(item), tagId, itemTagId: itemTagIdOf(uuid(item), tagId), name }, t.env);
  expect(r).toMatchObject({ ok: true });
  return tagId;
}

describe('tag read models', () => {
  it('tagsFor(itemId): live assignments on live tags, by name', async () => {
    const t = openTestDb();
    article(t, 1);
    article(t, 2, '2026-09-01');
    const b = await tag(t, 1, 'beta');
    await tag(t, 1, 'Alpha');
    await tag(t, 2, 'beta');
    expect(t.db.tagsFor(uuid(1))).toEqual([
      { itemTagId: itemTagIdOf(uuid(1), tagIdOf('alpha')), tagId: tagIdOf('alpha'), name: 'Alpha', nameKey: 'alpha' },
      { itemTagId: itemTagIdOf(uuid(1), b), tagId: b, name: 'beta', nameKey: 'beta' },
    ]);
    expect(t.db.tagsFor(uuid(9))).toEqual([]);
    t.tick();
    expect(t.db.dispatch({ kind: 'UntagArticle', itemTagId: itemTagIdOf(uuid(1), b) }, t.env)).toMatchObject({ ok: true });
    expect(t.db.tagsFor(uuid(1)).map((x) => x.name)).toEqual(['Alpha']);
    t.tick();
    expect(t.db.dispatch({ kind: 'DeleteTag', tagId: tagIdOf('alpha') }, t.env)).toMatchObject({ ok: true });
    expect(t.db.tagsFor(uuid(1))).toEqual([]);
  });

  it('allTags(): counts live assignments on live articles, grouped by name_key; unused live tags count 0', async () => {
    const t = openTestDb();
    article(t, 1);
    article(t, 2, '2026-09-01');
    article(t, 3, '2026-09-01');
    await tag(t, 1, 'ai');
    await tag(t, 2, 'AI');
    await tag(t, 3, 'ai');
    await tag(t, 1, 'zeta');
    await tag(t, 3, 'unused');
    t.tick();
    expect(t.db.dispatch({ kind: 'UntagArticle', itemTagId: itemTagIdOf(uuid(3), tagIdOf('unused')) }, t.env)).toMatchObject({ ok: true });
    t.tick();
    expect(t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(3) }, t.env)).toMatchObject({ ok: true }); // its 'ai' no longer counts
    expect(t.db.allTags()).toEqual([
      { nameKey: 'ai', name: 'ai', tagIds: [tagIdOf('ai')], count: 2 },
      { nameKey: 'unused', name: 'unused', tagIds: [tagIdOf('unused')], count: 0 },
      { nameKey: 'zeta', name: 'zeta', tagIds: [tagIdOf('zeta')], count: 1 },
    ]);
  });

  it('allTags() shows a concurrent duplicate (two live tags, one key) as one tag with both ids', () => {
    const t = openTestDb();
    article(t, 1);
    article(t, 2);
    const raw = t.raw;
    const ins = (id: string, created: string) => raw.exec(`INSERT INTO tags (id, name, name_key, created_at) VALUES ('${id}', 'ai', 'ai', '${created}')`);
    ins(uuid(0xb), '2026-09-02T00:00:00.000Z');
    ins(uuid(0xa), '2026-09-01T00:00:00.000Z');
    raw.exec(`INSERT INTO item_tags (id, item_id, tag_id, created_at) VALUES ('${uuid(0x51)}', '${uuid(1)}', '${uuid(0xa)}', 'x'), ('${uuid(0x52)}', '${uuid(2)}', '${uuid(0xb)}', 'x'), ('${uuid(0x53)}', '${uuid(2)}', '${uuid(0xa)}', 'x')`);
    expect(t.db.allTags()).toEqual([{ nameKey: 'ai', name: 'ai', tagIds: [uuid(0xa), uuid(0xb)], count: 2 }]);
  });

  it('tagSuggestions(prefix): live tags starting with the prefix (by name key), most used first, then name', async () => {
    const t = openTestDb();
    for (let i = 1; i <= 4; i++) article(t, i);
    await tag(t, 1, 'rust');
    await tag(t, 2, 'rust');
    await tag(t, 3, 'rust');
    await tag(t, 1, 'Reading list');
    await tag(t, 2, 'Reading list');
    await tag(t, 1, 'react');
    await tag(t, 1, 'sqlite');
    expect(t.db.tagSuggestions('r').map((s) => s.name)).toEqual(['rust', 'Reading list', 'react']);
    expect(t.db.tagSuggestions('  RE ').map((s) => s.name)).toEqual(['Reading list', 'react']);
    expect(t.db.tagSuggestions('')).toHaveLength(4);
    expect(t.db.tagSuggestions('r', 2).map((s) => s.name)).toEqual(['rust', 'Reading list']);
    expect(t.db.tagSuggestions('zzz')).toEqual([]);
    expect(t.db.tagSuggestions('r')[0]).toMatchObject({ nameKey: 'rust', count: 3 });
  });
});

describe('tag id resolution (research R3 steps 1-4)', () => {
  it('step 2: a new name gets its derived id', async () => {
    const t = openTestDb();
    expect(await t.db.resolveTagId('  Machine   Learning ', hashIdAsync)).toBe(tagIdOf('machine learning'));
  });

  it('step 1: a live tag with the same name key is reused, whatever its id', async () => {
    const t = openTestDb();
    t.raw.exec(`INSERT INTO tags (id, name, name_key, created_at) VALUES ('${uuid(0x77)}', 'AI', 'ai', '2026-09-01T00:00:00.000Z')`);
    expect(await t.db.resolveTagId('ai', hashIdAsync)).toBe(uuid(0x77));
  });

  it('step 1 with a concurrent duplicate: the earliest created (then id) wins', async () => {
    const t = openTestDb();
    t.raw.exec(`INSERT INTO tags (id, name, name_key, created_at) VALUES ('${uuid(0x78)}', 'ai', 'ai', '2026-09-01T00:00:00.000Z'), ('${uuid(0x77)}', 'ai', 'ai', '2026-09-01T00:00:00.000Z'), ('${uuid(0x76)}', 'ai', 'ai', '2026-09-02T00:00:00.000Z')`);
    expect(await t.db.resolveTagId('AI', hashIdAsync)).toBe(uuid(0x77));
  });

  it('step 3: the derived id is a tombstone, so it is restored (TagArticle restores it with the new name)', async () => {
    const t = openTestDb();
    article(t, 1);
    const id = await tag(t, 1, 'old');
    t.tick();
    expect(t.db.dispatch({ kind: 'DeleteTag', tagId: id }, t.env)).toMatchObject({ ok: true });
    expect(await t.db.resolveTagId('Old', hashIdAsync)).toBe(id);
    await tag(t, 1, 'Old');
    expect(t.db.tagsFor(uuid(1)).map((x) => [x.tagId, x.name])).toEqual([[id, 'Old']]);
  });

  it('step 4: the derived id is taken by a renamed live tag, so the first free derived id with |n is used', async () => {
    const t = openTestDb();
    article(t, 1);
    const id = await tag(t, 1, 'draft');
    t.tick();
    expect(t.db.dispatch({ kind: 'RenameTag', tagId: id, newName: 'final' }, t.env)).toMatchObject({ ok: true });
    // 'draft' is free by key, but its derived id belongs to the renamed tag.
    const first = (await t.db.resolveTagId('draft', hashIdAsync))!;
    expect(first).not.toBe(id);
    expect(first).toBe((await hashIdAsync(`readerlog-tag-v1|${tagKey('draft')}|1`)));
    await tag(t, 1, 'draft');
    expect(t.db.allTags().map((x) => x.nameKey)).toEqual(['draft', 'final']);
    // Remove the new 'draft' and delete it: its id is a tombstone, so step 3 restores `|1` rather than skipping to `|2`.
    t.tick();
    expect(t.db.dispatch({ kind: 'DeleteTag', tagId: first }, t.env)).toMatchObject({ ok: true });
    expect(await t.db.resolveTagId('draft', hashIdAsync)).toBe(first);
  });

  it('step 4 skips taken ids: |1 taken by a live other-key tag gives |2', async () => {
    const t = openTestDb();
    const base = await hashIdAsync(`readerlog-tag-v1|x`);
    const n1 = await hashIdAsync(`readerlog-tag-v1|x|1`);
    const n2 = await hashIdAsync(`readerlog-tag-v1|x|2`);
    t.raw.exec(`INSERT INTO tags (id, name, name_key, created_at) VALUES ('${base}', 'y', 'y', 'x'), ('${n1}', 'z', 'z', 'x')`);
    expect(await t.db.resolveTagId('x', hashIdAsync)).toBe(n2);
  });

  it('an invalid name resolves to null', async () => {
    const t = openTestDb();
    expect(await t.db.resolveTagId('   ', hashIdAsync)).toBeNull();
  });
});

describe('tag commands through the db (snapshots)', () => {
  it('TagArticle twice is a no-op; re-adding after Untag restores the same assignment row', async () => {
    const t = openTestDb();
    article(t, 1);
    const id = await tag(t, 1, 'ai');
    const rows = () => t.raw.selectValue('SELECT count(*) FROM item_tags');
    expect(rows()).toBe(1);
    await tag(t, 1, 'AI');
    expect(rows()).toBe(1);
    const it1 = itemTagIdOf(uuid(1), id);
    t.tick();
    t.db.dispatch({ kind: 'UntagArticle', itemTagId: it1 }, t.env);
    expect(t.db.tagsFor(uuid(1))).toEqual([]);
    await tag(t, 1, 'ai');
    expect(rows()).toBe(1);
    expect(t.db.tagsFor(uuid(1)).map((x) => x.itemTagId)).toEqual([it1]);
  });

  it('TagArticle on a book or a missing item is NotFound', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Dune', startNow: false, localDate: '2026-09-01' }, t.env);
    const tagId = tagIdOf('ai');
    for (const n of [9, 77]) {
      expect(t.db.dispatch({ kind: 'TagArticle', itemId: uuid(n), tagId, itemTagId: itemTagIdOf(uuid(n), tagId), name: 'ai' }, t.env)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    }
    expect(t.raw.selectValue('SELECT count(*) FROM tags')).toBe(0);
  });

  it('a TooManyTags rejection writes nothing', async () => {
    const t = openTestDb();
    article(t, 1);
    for (let i = 0; i < 20; i++) await tag(t, 1, `tag${i}`);
    const before = t.raw.selectValue('SELECT count(*) FROM change_log');
    const tagId = tagIdOf('one-more');
    expect(t.db.dispatch({ kind: 'TagArticle', itemId: uuid(1), tagId, itemTagId: itemTagIdOf(uuid(1), tagId), name: 'one more' }, t.env)).toMatchObject({ ok: false, error: { kind: 'TooManyTags' } });
    expect(t.raw.selectValue('SELECT count(*) FROM change_log')).toBe(before);
  });

  it('RenameTag merge moves assignments to the target and tombstones the source', async () => {
    const t = openTestDb();
    for (let i = 1; i <= 2; i++) article(t, i);
    const a = await tag(t, 1, 'ml');
    const b = await tag(t, 2, 'machine learning');
    await tag(t, 1, 'machine learning');
    t.tick();
    const moves = [{ from: itemTagIdOf(uuid(1), a), to: itemTagIdOf(uuid(1), b), itemId: uuid(1) }];
    expect(t.db.dispatch({ kind: 'RenameTag', tagId: a, newName: 'Machine Learning', merge: { targetTagId: b, moves } }, t.env)).toMatchObject({ ok: true });
    expect(t.db.allTags()).toEqual([{ nameKey: 'machine learning', name: 'machine learning', tagIds: [b], count: 2 }]);
    expect(t.db.tagsFor(uuid(1)).map((x) => x.tagId)).toEqual([b]);
  });

  it('ReconcileSavedArticle moves the read date, highlights and tags onto the older saved article', async () => {
    const t = openTestDb();
    article(t, 1); // saved, older
    t.tick();
    expect(t.db.dispatch({ kind: 'AddArticle', itemId: uuid(2), url: 'https://www.example.com/a1', title: 'Logged copy', author: null, wordCount: 10, readOn: '2026-09-12', detailsStatus: 'complete' }, t.env)).toMatchObject({ ok: true });
    t.tick();
    expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(0x30), itemId: uuid(2), quote: 'A passage', localDate: '2026-09-12' }, t.env)).toMatchObject({ ok: true });
    const id = await tag(t, 2, 'ai');
    t.tick();
    const r = t.db.dispatch({
      kind: 'ReconcileSavedArticle', survivorId: uuid(1), duplicateId: uuid(2),
      copies: [{ from: uuid(0x30), to: uuid(0x31) }],
      tagMoves: [{ from: itemTagIdOf(uuid(2), id), to: itemTagIdOf(uuid(1), id), itemId: uuid(1) }],
    }, t.env);
    expect(r).toMatchObject({ ok: true });
    expect(t.db.savedArticles()).toEqual([]);
    expect(t.db.articles().map((a) => [a.id, a.readOn])).toEqual([[uuid(1), '2026-09-12']]);
    expect(t.db.highlights(uuid(1)).map((h) => h.quote)).toEqual(['A passage']);
    expect(t.db.tagsFor(uuid(1)).map((x) => x.name)).toEqual(['ai']);
    expect(t.db.tagsFor(uuid(2))).toEqual([]);
  });
});
