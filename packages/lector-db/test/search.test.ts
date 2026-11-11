import { describe, expect, it } from 'vitest';
import { hashIdAsync, itemTagIdOf, openTestDb, uuid, type TestDb } from './helpers.ts';

function article(t: TestDb, n: number, p: { title: string; author?: string | null; url?: string; readOn?: string }) {
  t.tick();
  expect(t.db.dispatch({ kind: 'AddArticle', itemId: uuid(n), url: p.url ?? `https://www.example.com/a${n}`, title: p.title, author: p.author ?? null, wordCount: 476, ...(p.readOn ? { readOn: p.readOn } : {}), detailsStatus: 'complete' }, t.env)).toMatchObject({ ok: true });
}
async function tag(t: TestDb, item: number, name: string) {
  t.tick();
  const tagId = (await t.db.resolveTagId(name, hashIdAsync))!;
  expect(t.db.dispatch({ kind: 'TagArticle', itemId: uuid(item), tagId, itemTagId: itemTagIdOf(uuid(item), tagId), name }, t.env)).toMatchObject({ ok: true });
}
function highlight(t: TestDb, n: number, item: number, p: { quote?: string; note?: string }) {
  t.tick();
  expect(t.db.dispatch({ kind: 'AddHighlight', highlightId: uuid(n), itemId: uuid(item), ...p, localDate: '2026-09-01' }, t.env)).toMatchObject({ ok: true });
}
const ids = (hits: { itemId: string }[]) => hits.map((h) => h.itemId);

describe('article search (008 R5)', () => {
  it('matches title, author and site; terms are ANDed; case is ignored', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Rust ownership explained', author: 'Ada Lovelace', readOn: '2026-09-01', url: 'https://blog.rustlang.example/own' });
    article(t, 2, { title: 'Explained: the sea', author: 'Ada Lovelace', readOn: '2026-09-02' });
    article(t, 3, { title: 'Gardening' });
    expect(ids(t.db.search('RUST'))).toEqual([uuid(1)]);
    expect(ids(t.db.search('ada'))).toEqual([uuid(2), uuid(1)]);
    expect(ids(t.db.search('ada rust'))).toEqual([uuid(1)]);
    expect(ids(t.db.search('explained  ada'))).toEqual([uuid(2), uuid(1)]);
    expect(ids(t.db.search('rustlang'))).toEqual([uuid(1)]); // domain
    expect(ids(t.db.search('rust gardening'))).toEqual([]);
    expect(t.db.search('')).toEqual([]);
    expect(t.db.search('   ')).toEqual([]);
  });

  it('a term must lie within one field (it does not span title and author)', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Alpha', author: 'Beta', readOn: '2026-09-01' });
    expect(ids(t.db.search('alphabeta'))).toEqual([]);
    expect(ids(t.db.search('alpha beta'))).toEqual([uuid(1)]);
  });

  it('folds accents on both sides', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Café society', author: 'Ñandú Pérez', readOn: '2026-09-01' });
    article(t, 2, { title: 'Plain cafe', readOn: '2026-09-02' });
    expect(ids(t.db.search('cafe')).sort()).toEqual([uuid(1), uuid(2)].sort());
    expect(ids(t.db.search('CAFÉ')).sort()).toEqual([uuid(1), uuid(2)].sort());
    expect(ids(t.db.search('nandu perez'))).toEqual([uuid(1)]);
  });

  it('labels read and saved articles, newest first (read date, else saved date)', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Topic one', readOn: '2026-09-01' });
    article(t, 2, { title: 'Topic two' }); // saved at 2026-09-27
    article(t, 3, { title: 'Topic three', readOn: '2026-09-10' });
    const hits = t.db.search('topic');
    expect(hits.map((h) => [h.itemId, h.status])).toEqual([[uuid(2), 'saved'], [uuid(3), 'read'], [uuid(1), 'read']]);
    expect(hits[1]).toMatchObject({ title: 'Topic three', author: null, domain: 'example.com', readOn: '2026-09-10', passage: null });
    expect(hits[0]!.readOn).toBeNull();
  });

  it('matches tag names, and the tag filter is AND over chips', async () => {
    const t = openTestDb();
    article(t, 1, { title: 'One', readOn: '2026-09-01' });
    article(t, 2, { title: 'Two', readOn: '2026-09-02' });
    article(t, 3, { title: 'Three' });
    await tag(t, 1, 'Machine Learning');
    await tag(t, 1, 'to-read');
    await tag(t, 2, 'to-read');
    await tag(t, 3, 'machine learning');
    await tag(t, 3, 'to-read');
    expect(ids(t.db.search('machine'))).toEqual([uuid(3), uuid(1)]);
    expect(ids(t.db.search('two machine'))).toEqual([]);
    // Filter only (empty text): chips are name keys.
    expect(ids(t.db.search('', { tagKeys: ['to-read'] }))).toEqual([uuid(3), uuid(2), uuid(1)]);
    expect(ids(t.db.search('', { tagKeys: ['to-read', 'machine learning'] }))).toEqual([uuid(3), uuid(1)]);
    expect(ids(t.db.search('three', { tagKeys: ['to-read', 'machine learning'] }))).toEqual([uuid(3)]);
    expect(ids(t.db.search('one', { tagKeys: ['to-read', 'machine learning'] }))).toEqual([uuid(1)]);
    expect(ids(t.db.search('two', { tagKeys: ['machine learning'] }))).toEqual([]);
    expect(ids(t.db.search('', { tagKeys: ['nope'] }))).toEqual([]);
    expect(ids(t.db.search('', { tagKeys: ['TO-READ'] }))).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  it('matches highlight quotes and notes and returns the matched passage', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Plain title', readOn: '2026-09-01' });
    article(t, 2, { title: 'Other', readOn: '2026-09-02' });
    highlight(t, 0x30, 1, { quote: 'First passage about nothing' });
    highlight(t, 0x31, 1, { quote: 'The Quokka is a small marsupial', note: 'my note on Mammals' });
    highlight(t, 0x32, 1, { note: 'Another quokka remark' });
    const hits = t.db.search('quokka');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ itemId: uuid(1), passage: { kind: 'quote', text: 'The Quokka is a small marsupial' } });
    expect(t.db.search('mammals')[0]).toMatchObject({ passage: { kind: 'note', text: 'my note on Mammals' } });
    expect(t.db.search('remark')[0]!.passage).toEqual({ kind: 'note', text: 'Another quokka remark' });
    // A match from the title alone carries no passage.
    expect(t.db.search('plain')[0]!.passage).toBeNull();
    // AND across fields: title term plus a highlight term.
    expect(ids(t.db.search('plain quokka'))).toEqual([uuid(1)]);
    expect(t.db.search('plain quokka')[0]!.passage).toMatchObject({ text: 'The Quokka is a small marsupial' });
  });

  it('removed highlights, tags and articles stop matching (the index follows changes)', async () => {
    const t = openTestDb();
    article(t, 1, { title: 'Alpha', readOn: '2026-09-01' });
    highlight(t, 0x30, 1, { quote: 'Needle in a haystack' });
    await tag(t, 1, 'haystack-tag');
    expect(ids(t.db.search('needle'))).toEqual([uuid(1)]);
    expect(ids(t.db.search('haystack-tag'))).toEqual([uuid(1)]);
    t.tick();
    t.db.dispatch({ kind: 'RemoveHighlight', highlightId: uuid(0x30) }, t.env);
    expect(t.db.search('needle')).toEqual([]);
    t.tick();
    const tagId = await t.db.resolveTagId('haystack-tag', hashIdAsync);
    t.db.dispatch({ kind: 'DeleteTag', tagId: tagId! }, t.env);
    expect(t.db.search('haystack-tag')).toEqual([]);
    t.tick();
    t.db.dispatch({ kind: 'RemoveArticle', itemId: uuid(1) }, t.env);
    expect(t.db.search('alpha')).toEqual([]);
  });

  it('never matches books, and honours the result limit', () => {
    const t = openTestDb();
    t.db.dispatch({ kind: 'AddBook', itemId: uuid(9), title: 'Topic book', startNow: false, localDate: '2026-09-01' }, t.env);
    for (let i = 1; i <= 5; i++) article(t, i, { title: `Topic ${i}`, readOn: '2026-09-01' });
    expect(t.db.search('topic')).toHaveLength(5);
    expect(t.db.search('topic', { limit: 2 })).toHaveLength(2);
  });

  it('sees changes made straight to the database (the index is keyed to the change log)', () => {
    const t = openTestDb();
    article(t, 1, { title: 'Alpha', readOn: '2026-09-01' });
    expect(ids(t.db.search('alpha'))).toEqual([uuid(1)]);
    article(t, 2, { title: 'Alpha again', readOn: '2026-09-02' });
    expect(ids(t.db.search('alpha'))).toEqual([uuid(2), uuid(1)]);
  });
});
