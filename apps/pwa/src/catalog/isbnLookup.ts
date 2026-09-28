import type { Isbn13 } from '@readerlog/core';
import { parseGbVolume } from './googleBooks.ts';
import { mergeDetails } from './merge.ts';
import { createGetter } from './request.ts';
import { parseOlEdition, parseOlSearchDoc } from './openLibrary.ts';
import type { LookupDeps, LookupOutcome } from './types.ts';

const OL_SEARCH_FIELDS = 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject';

export async function lookupIsbn(isbn: Isbn13, deps: LookupDeps): Promise<LookupOutcome> {
  if (!deps.online()) return { kind: 'unavailable', reason: 'offline' };

  const get = createGetter(deps);

  const [searchRes, editionRes] = await Promise.all([
    get(`https://openlibrary.org/search.json?isbn=${isbn}&fields=${OL_SEARCH_FIELDS}&limit=1`),
    get(`https://openlibrary.org/isbn/${isbn}.json`),
  ]);
  // #2 failing (404, network, timeout) only loses the exact pages and edition cover.
  const edition = editionRes.kind === 'ok' ? parseOlEdition(editionRes.json) : null;

  const docs = searchRes.kind === 'ok' ? (searchRes.json as { docs?: unknown })?.docs : undefined;
  const search = Array.isArray(docs) ? parseOlSearchDoc(docs[0]) : null;
  if (search) return { kind: 'found', details: mergeDetails({ search, edition, google: null }) };

  if (searchRes.kind === 'timeout') return { kind: 'timeout' };

  const googleRes = await get(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1`);
  if (googleRes.kind === 'timeout') return { kind: 'timeout' };
  if (googleRes.kind === 'ok') {
    const items = (googleRes.json as { items?: unknown })?.items;
    const google = Array.isArray(items) ? parseGbVolume(items[0]) : null;
    if (google) return { kind: 'found', details: mergeDetails({ search: null, edition, google }) };
  }

  // No title anywhere. notFound only if every queried catalog answered successfully.
  const failure = searchRes.kind === 'fail' ? searchRes : googleRes.kind === 'fail' ? googleRes : null;
  if (failure) {
    return failure.status === undefined
      ? { kind: 'unavailable', reason: failure.reason }
      : { kind: 'unavailable', reason: failure.reason, status: failure.status };
  }
  return { kind: 'notFound' };
}
