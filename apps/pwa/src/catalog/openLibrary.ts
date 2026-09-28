import { toCoverUrl } from './cover.ts';
import { genreFromSubjects } from './genre.ts';
import { isObj, strings, validPages, type PartialDetails } from './types.ts';

const validCoverId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** One doc of search.json (#1). Null when missing or without a title. */
export function parseOlSearchDoc(doc: unknown): PartialDetails | null {
  if (!isObj(doc) || typeof doc['title'] !== 'string' || doc['title'].trim() === '') return null;
  return {
    title: doc['title'].trim(),
    authors: strings(doc['author_name']),
    totalPages: validPages(doc['number_of_pages_median']),
    genre: genreFromSubjects(strings(doc['subject'])),
    coverUrl: validCoverId(doc['cover_i']) ? toCoverUrl(doc['cover_i']) : null,
    firstPublishYear:
      typeof doc['first_publish_year'] === 'number' && Number.isInteger(doc['first_publish_year'])
        ? doc['first_publish_year']
        : null,
  };
}

/** The edition record (#2): exact pages and the first valid cover id. */
export function parseOlEdition(json: unknown): { totalPages: number | null; coverUrl: string | null } {
  if (!isObj(json)) return { totalPages: null, coverUrl: null };
  const id = Array.isArray(json['covers']) ? json['covers'].find(validCoverId) : undefined;
  return { totalPages: validPages(json['number_of_pages']), coverUrl: id === undefined ? null : toCoverUrl(id) };
}
