import { describe, expect, it } from 'vitest';
import { decide, type Command, type Item } from '../src/index.ts';
import { applyToSnapshot, book, NOW, snap, uuid } from './fixtures.ts';

const add = (p: Partial<Extract<Command, { kind: 'AddArticle' }>> = {}): Command => ({
  kind: 'AddArticle',
  itemId: uuid(50),
  url: 'HTTPS://www.Example.com/a?utm_source=x&b=1#top',
  title: '  A Long Essay ',
  author: 'Ada',
  wordCount: 2380,
  readOn: '2026-09-27',
  detailsStatus: 'complete',
  ...p,
});

const changesOf = (r: ReturnType<typeof decide>) => {
  if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
  return r.value.changes;
};

/** Apply an AddArticle to get a live article snapshot. */
const articleSnap = (p: Partial<Extract<Command, { kind: 'AddArticle' }>> = {}) => {
  const s = applyToSnapshot(null, changesOf(decide(null, add(p), NOW)));
  if (!s) throw new Error('no snapshot');
  return s;
};

describe('decide AddArticle', () => {
  it('emits one items insert with the normalized fields', () => {
    expect(decide(null, add(), NOW)).toEqual({
      ok: true,
      value: {
        offerFinish: false,
        changes: [
          {
            tbl: 'items',
            rowId: uuid(50),
            fields: {
              type: 'article',
              title: 'A Long Essay',
              author: 'Ada',
              url: 'https://www.example.com/a?b=1',
              domain: 'example.com',
              word_count: 2380,
              read_on: '2026-09-27',
              metadata_status: 'ok',
              created_at: NOW,
            },
          },
        ],
      },
    });
  });

  it('author and word_count are null when absent; notFound gives failed', () => {
    const c = changesOf(decide(null, add({ author: null, wordCount: null, detailsStatus: 'notFound' }), NOW));
    expect(c).toHaveLength(1);
    expect(c[0]!.fields).toMatchObject({ author: null, word_count: null, metadata_status: 'failed' });
  });

  it('accepts word counts 0 and 100000', () => {
    expect(decide(null, add({ wordCount: 0 }), NOW).ok).toBe(true);
    expect(decide(null, add({ wordCount: 100000 }), NOW).ok).toBe(true);
  });

  it('a blank title is TitleRequired', () => {
    expect(decide(null, add({ title: '  ' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
  });

  it.each(['ftp://example.com/x', 'not a url'])('%s is InvalidUrl', (url) =>
    expect(decide(null, add({ url }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidUrl' } }));

  it.each([-1, 100001, 1.5])('wordCount %s is InvalidInput', (wordCount) =>
    expect(decide(null, add({ wordCount }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'wordCount' } }));

  it('a bad readOn or itemId is InvalidInput', () => {
    expect(decide(null, add({ readOn: '2026-02-30' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'readOn' } });
    expect(decide(null, add({ itemId: 'nope' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'itemId' } });
  });

  it('an over-long author is InvalidInput', () =>
    expect(decide(null, add({ author: 'x'.repeat(201) }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'author' } }));

  it('A-1: an existing id is AlreadyExists', () => {
    expect(decide(articleSnap(), add(), NOW)).toEqual({ ok: false, error: { kind: 'AlreadyExists' } });
    expect(decide(snap(book({ id: uuid(50) as Item['id'] })), add(), NOW)).toEqual({ ok: false, error: { kind: 'AlreadyExists' } });
  });
});

describe('decide EditArticle', () => {
  const edit = (p: Partial<Extract<Command, { kind: 'EditArticle' }>>): Command => ({ kind: 'EditArticle', itemId: uuid(50), ...p });

  it('emits only the fields that changed', () => {
    expect(changesOf(decide(articleSnap(), edit({ title: 'New', author: 'Ada', readOn: '2026-09-01' }), NOW))).toEqual([
      { tbl: 'items', rowId: uuid(50), fields: { title: 'New', read_on: '2026-09-01' } },
    ]);
  });

  it('an unchanged value emits nothing', () => {
    expect(decide(articleSnap(), edit({ title: ' A Long Essay ', author: 'Ada', readOn: '2026-09-27' }), NOW)).toEqual({
      ok: true,
      value: { offerFinish: false, changes: [] },
    });
  });

  it('clearing the author sets null', () =>
    expect(changesOf(decide(articleSnap(), edit({ author: ' ' }), NOW))[0]!.fields).toEqual({ author: null }));

  it('rejects a blank title and a bad date', () => {
    expect(decide(articleSnap(), edit({ title: ' ' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
    expect(decide(articleSnap(), edit({ readOn: 'yesterday' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput' } });
  });

  it('A-2: NotFound for a book, a missing or a removed article', () => {
    expect(decide(snap(book({ id: uuid(50) as Item['id'] })), edit({ title: 'X' }), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(null, edit({ title: 'X' }), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    const removed = { ...articleSnap(), item: { ...articleSnap().item, deletedAt: NOW } };
    expect(decide(removed, edit({ title: 'X' }), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('decide RemoveArticle', () => {
  const rm: Command = { kind: 'RemoveArticle', itemId: uuid(50) };

  it('tombstones the article; a second removal is a no-op', () => {
    const s = articleSnap();
    const c = changesOf(decide(s, rm, NOW));
    expect(c).toEqual([{ tbl: 'items', rowId: uuid(50), fields: { deleted_at: NOW } }]);
    const after = applyToSnapshot(s, c);
    expect(decide(after, rm, NOW)).toEqual({ ok: true, value: { offerFinish: false, changes: [] } });
  });

  it('a book id or a missing id is NotFound', () => {
    expect(decide(snap(book({ id: uuid(50) as Item['id'] })), rm, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(null, rm, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('book commands on an article (A-2)', () => {
  const notFound = { ok: false, error: { kind: 'NotFound' } };
  const s = articleSnap();
  it.each<[string, Command]>([
    ['LogEvent', { kind: 'LogEvent', itemId: uuid(50), eventId: uuid(900), type: 'started', localDate: '2026-09-27' }],
    ['EditBook', { kind: 'EditBook', itemId: uuid(50), title: 'X' }],
    ['RemoveBook', { kind: 'RemoveBook', itemId: uuid(50) }],
    ['FillDetails', { kind: 'FillDetails', itemId: uuid(50), outcome: 'notFound' }],
    ['RemoveEvent', { kind: 'RemoveEvent', itemId: uuid(50), eventId: uuid(900) }],
  ])('%s is NotFound', (_n, cmd) => expect(decide(s, cmd, NOW)).toEqual(notFound));

});
