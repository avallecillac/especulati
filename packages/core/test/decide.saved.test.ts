import { describe, expect, it } from 'vitest';
import { decide, tierOf, type Change, type Command, type Item } from '../src/index.ts';
import { book, itemId, NOW, snap } from './fixtures.ts';

const ID = itemId(50);
const URL = 'https://example.com/post';

const article = (p: Partial<Item> = {}): Item =>
  book({
    id: ID,
    type: 'article',
    title: 'A Post' as Item['title'],
    author: 'Ann' as Item['author'],
    totalPages: null,
    url: URL as Item['url'],
    domain: 'example.com',
    wordCount: 1200,
    readOn: null,
    ...p,
  });

const changesOf = (r: ReturnType<typeof decide>): readonly Change[] => {
  if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
  return r.value.changes;
};

const add = (p: Partial<Extract<Command, { kind: 'AddArticle' }>> = {}): Command => ({
  kind: 'AddArticle',
  itemId: ID,
  url: URL,
  title: 'A Post',
  detailsStatus: 'complete',
  ...p,
});

describe('AddArticle without readOn (saved)', () => {
  it('inserts with read_on explicitly null, in the s tier', () => {
    const [c] = changesOf(decide(null, add(), NOW));
    expect('read_on' in c!.fields).toBe(true);
    expect(c!.fields['read_on']).toBeNull();
    expect(c!.fields['created_at']).toBe(NOW);
    expect(tierOf(c!.tbl, c!.fields)).toBe('s');
  });
  it('with readOn is still a base insert', () => {
    const [c] = changesOf(decide(null, add({ readOn: '2026-09-01' }), NOW));
    expect(c!.fields['read_on']).toBe('2026-09-01');
    expect(tierOf(c!.tbl, c!.fields)).toBe('base');
  });
  it('still rejects an invalid readOn when given', () => {
    const r = decide(null, add({ readOn: 'nope' }), NOW);
    expect(r.ok).toBe(false);
  });
});

describe('MarkArticleRead', () => {
  const cmd: Command = { kind: 'MarkArticleRead', itemId: ID, readOn: '2026-10-01' };

  it('emits every article insert field plus read_on (S-2), as a base op', () => {
    const [c, ...rest] = changesOf(decide(snap(article()), cmd, NOW));
    expect(rest).toEqual([]);
    expect(c).toEqual({
      tbl: 'items',
      rowId: ID,
      fields: {
        type: 'article',
        title: 'A Post',
        url: URL,
        domain: 'example.com',
        author: 'Ann',
        word_count: 1200,
        metadata_status: 'ok',
        created_at: article().createdAt,
        read_on: '2026-10-01',
      },
    });
    expect(tierOf(c!.tbl, c!.fields)).toBe('base');
  });
  it('AlreadyRead on a read article', () => {
    const r = decide(snap(article({ readOn: '2026-09-01' as Item['readOn'] })), cmd, NOW);
    expect(r).toEqual({ ok: false, error: { kind: 'AlreadyRead' } });
  });
  it('NotFound on a book, a removed item, or nothing', () => {
    expect(decide(snap(book({ id: ID })), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(article({ deletedAt: NOW })), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(null, cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
  it('InvalidInput on a bad date', () => {
    const r = decide(snap(article()), { ...cmd, readOn: '2026-13-45' }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('InvalidInput');
  });
});

describe('MarkArticleUnread', () => {
  const cmd: Command = { kind: 'MarkArticleUnread', itemId: ID };
  it('sets read_on null, in the s tier', () => {
    const [c] = changesOf(decide(snap(article({ readOn: '2026-09-01' as Item['readOn'] })), cmd, NOW));
    expect(c).toEqual({ tbl: 'items', rowId: ID, fields: { read_on: null } });
    expect(tierOf(c!.tbl, c!.fields)).toBe('s');
  });
  it('NotRead on a saved article', () => {
    expect(decide(snap(article()), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotRead' } });
  });
  it('NotFound on a book or a removed article', () => {
    expect(decide(snap(book({ id: ID })), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(article({ deletedAt: NOW, readOn: '2026-09-01' as Item['readOn'] })), cmd, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});
