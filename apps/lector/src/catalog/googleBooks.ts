import { genreFromSubjects } from './genre.ts';
import { isObj, strings, validPages, type PartialDetails } from './types.ts';


/** One item of a volumes response. Null when missing or without a title. */
export function parseGbVolume(item: unknown): PartialDetails | null {
  const v = isObj(item) ? item['volumeInfo'] : undefined;
  if (!isObj(v) || typeof v['title'] !== 'string' || v['title'].trim() === '') return null;
  const thumb = isObj(v['imageLinks']) && typeof v['imageLinks']['thumbnail'] === 'string' ? v['imageLinks']['thumbnail'] : null;
  return {
    title: v['title'].trim(),
    authors: strings(v['authors']),
    totalPages: validPages(v['pageCount']),
    genre: genreFromSubjects(strings(v['categories'])),
    coverUrl: thumb === null ? null : thumb.replace(/^http:\/\//i, 'https://'),
    firstPublishYear: null,
  };
}
