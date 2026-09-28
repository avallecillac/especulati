import { parseIsbn } from '@readerlog/core';
import { parseGbVolume } from './googleBooks.ts';
import { parseOlSearchDoc } from './openLibrary.ts';
import { createGetter } from './request.ts';
import { isObj, strings, type Isbn13, type LookupDeps, type SearchHit, type SearchOutcome } from './types.ts';

const MIN_QUERY = 3;
const MAX_HITS = 20;
const OL_FIELDS = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,isbn';

/** First 13-char entry that passes parseIsbn, else the first 10-char entry that converts. */
function pickIsbn(candidates: string[]): Isbn13 | null {
  for (const len of [13, 10]) {
    for (const c of candidates) {
      if (c.length !== len) continue;
      const r = parseIsbn(c);
      if (r.ok) return r.value;
    }
  }
  return null;
}

/** Title search (contract requests #4 and #5). A query under 3 characters is never sent. */
export async function searchTitle(query: string, deps: LookupDeps): Promise<SearchOutcome> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return { kind: 'results', hits: [] };
  if (!deps.online()) return { kind: 'unavailable' };

  const get = createGetter(deps);
  const enc = encodeURIComponent(q);

  const ol = await get(`https://openlibrary.org/search.json?q=${enc}&fields=${OL_FIELDS}&limit=${MAX_HITS}`);
  if (ol.kind === 'timeout') return { kind: 'timeout' };
  if (ol.kind === 'ok') {
    const docs = (ol.json as { docs?: unknown })?.docs;
    const hits: SearchHit[] = [];
    for (const doc of Array.isArray(docs) ? docs : []) {
      const d = parseOlSearchDoc(doc);
      if (!d || !isObj(doc)) continue;
      const key = typeof doc['key'] === 'string' ? doc['key'] : `ol:${hits.length}`;
      hits.push({ ...d, source: 'openlibrary', key, isbn: pickIsbn(strings(doc['isbn'])) });
      if (hits.length === MAX_HITS) break;
    }
    return { kind: 'results', hits };
  }

  // Open Library failed (not merely empty): try Google Books.
  const gb = await get(`https://www.googleapis.com/books/v1/volumes?q=${enc}&maxResults=${MAX_HITS}`);
  if (gb.kind === 'timeout') return { kind: 'timeout' };
  if (gb.kind !== 'ok') return { kind: 'unavailable' };
  const items = (gb.json as { items?: unknown })?.items;
  const hits: SearchHit[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const d = parseGbVolume(item);
    if (!d || !isObj(item)) continue;
    const ids = (item['volumeInfo'] as { industryIdentifiers?: unknown }).industryIdentifiers;
    const isbns = Array.isArray(ids)
      ? ids.flatMap((i) => (isObj(i) && typeof i['identifier'] === 'string' ? [i['identifier']] : []))
      : [];
    const key = typeof item['id'] === 'string' ? item['id'] : `gb:${hits.length}`;
    hits.push({ ...d, source: 'googlebooks', key, isbn: pickIsbn(isbns) });
    if (hits.length === MAX_HITS) break;
  }
  return { kind: 'results', hits };
}
