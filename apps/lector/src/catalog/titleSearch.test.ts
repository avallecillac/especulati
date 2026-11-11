import { describe, expect, it } from 'vitest';
import { searchTitle } from './titleSearch.ts';
import { fakeFetch, fixture, gbTitleUrl, olTitleUrl } from './testkit.ts';

const online = () => true;
const Q = 'left hand of darkness';

const gbBody = JSON.stringify({
  items: [
    {
      id: 'GB1',
      volumeInfo: {
        title: 'Dune',
        authors: ['Frank Herbert'],
        pageCount: 612,
        categories: ['Fiction'],
        imageLinks: { thumbnail: 'http://books.google.com/x.jpg' },
        industryIdentifiers: [
          { type: 'ISBN_10', identifier: '0441172717' },
          { type: 'ISBN_13', identifier: '9780441172719' },
        ],
      },
    },
    { id: 'GB2', volumeInfo: { title: 'No isbn here' } },
  ],
});

describe('searchTitle', () => {
  it('maps the recorded fixture to at most 20 hits with year and cover', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: { body: fixture('ol-search-q-left-hand') } });
    const out = await searchTitle(Q, { fetch: f.fetch, online });
    expect(out.kind).toBe('results');
    if (out.kind !== 'results') return;
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits.length).toBeLessThanOrEqual(20);
    expect(out.hits[0]).toMatchObject({
      key: '/works/OL59800W',
      title: 'The Left Hand of Darkness',
      authors: ['Ursula K. Le Guin'],
      firstPublishYear: 1969,
      totalPages: 304,
      coverUrl: 'https://covers.openlibrary.org/b/id/10618463-L.jpg',
      source: 'openlibrary',
    });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  });

  it('isbn is the first 13-digit entry that passes parseIsbn, else a convertible ISBN-10, else null', async () => {
    const doc = (isbn: string[]) => ({ key: '/works/X', title: 'T', isbn });
    const body = JSON.stringify({
      docs: [
        doc(['9780441478027', '9780441478026', '9788445009314']), // first fails the check digit
        doc(['0441478069', '1234567']), // only an ISBN-10 that converts
        doc(['1234567890123', 'nope']),
        { key: '/works/Y', title: 'No isbn field' },
      ],
    });
    const out = await searchTitle(Q, { fetch: fakeFetch({ [olTitleUrl(Q)]: { body } }).fetch, online });
    if (out.kind !== 'results') throw new Error('expected results');
    expect(out.hits.map((h) => h.isbn)).toEqual(['9780441478026', '9780441478064', null, null]);
  });

  it('caps at 20 hits', async () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ key: `/works/${i}`, title: `T${i}` }));
    const out = await searchTitle(Q, { fetch: fakeFetch({ [olTitleUrl(Q)]: { body: JSON.stringify({ docs }) } }).fetch, online });
    expect(out.kind === 'results' && out.hits.length).toBe(20);
  });

  it('OL 500 + Google ok → Google hits', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: { status: 500 }, [gbTitleUrl(Q)]: { body: gbBody } });
    const out = await searchTitle(Q, { fetch: f.fetch, online });
    expect(out).toMatchObject({
      kind: 'results',
      hits: [
        { key: 'GB1', title: 'Dune', isbn: '9780441172719', totalPages: 612, coverUrl: 'https://books.google.com/x.jpg', source: 'googlebooks' },
        { key: 'GB2', title: 'No isbn here', isbn: null },
      ],
    });
  });

  it('OL network error + Google ok → Google hits', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: 'throw', [gbTitleUrl(Q)]: { body: gbBody } });
    expect((await searchTitle(Q, { fetch: f.fetch, online })).kind).toBe('results');
  });

  it('OL and Google both failing → unavailable', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: { status: 500 }, [gbTitleUrl(Q)]: { status: 429 } });
    expect(await searchTitle(Q, { fetch: f.fetch, online })).toEqual({ kind: 'unavailable' });
  });

  it('OL empty → no matches, and Google is not called', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: { body: '{"numFound":0,"docs":[]}' } });
    expect(await searchTitle(Q, { fetch: f.fetch, online })).toEqual({ kind: 'results', hits: [] });
    expect(f.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  });

  it('offline → unavailable with no fetch', async () => {
    const f = fakeFetch();
    expect(await searchTitle(Q, { fetch: f.fetch, online: () => false })).toEqual({ kind: 'unavailable' });
    expect(f.calls).toHaveLength(0);
  });

  it('a hanging fetch → timeout', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: 'hang' });
    expect(await searchTitle(Q, { fetch: f.fetch, online, timeoutMs: 50 })).toEqual({ kind: 'timeout' });
  });

  it('a query under 3 characters is never sent', async () => {
    const f = fakeFetch();
    expect(await searchTitle('  ab ', { fetch: f.fetch, online })).toEqual({ kind: 'results', hits: [] });
    expect(f.calls).toHaveLength(0);
  });

  it('trims the query before sending it', async () => {
    const f = fakeFetch({ [olTitleUrl(Q)]: { body: '{"docs":[]}' } });
    await searchTitle(`  ${Q}  `, { fetch: f.fetch, online });
    expect(f.calls[0]?.url).toBe(olTitleUrl(Q));
  });
});
