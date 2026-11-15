import { countryName } from './countries.ts';

/** List search (cinefilo-compact-lists D2): NFD, no combining marks, lower-case, collapsed whitespace, trimmed. */
export function normalise(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when the normalised query is a substring of the normalised title; an empty query matches everything. */
export function matchesQuery(title: string, query: string): boolean {
  const q = normalise(query);
  return q === '' || normalise(title).includes(q);
}

/** What a list row offers the search besides its title (cinefilo-tmdb-credits D7). */
export interface Searchable {
  readonly title: string;
  readonly directors: readonly string[];
  readonly leadActor: string | null;
  readonly leadActress: string | null;
  readonly genres: readonly string[];
  readonly countries: readonly string[];
}

/**
 * True when the normalised query is a substring of the title, a director, the lead actor or actress, a genre or a
 * country's English name, or equals a country's code ("it" finds Italy without finding every title with "it" in it).
 */
export function matchesItem(item: Searchable, query: string): boolean {
  const q = normalise(query);
  if (q === '') return true;
  const texts = [item.title, ...item.directors, ...item.genres, ...item.countries.map(countryName)];
  if (item.leadActor) texts.push(item.leadActor);
  if (item.leadActress) texts.push(item.leadActress);
  return texts.some((t) => normalise(t).includes(q)) || item.countries.some((c) => normalise(c) === q);
}
