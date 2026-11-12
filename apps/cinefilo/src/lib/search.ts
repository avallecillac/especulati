/** List search (cinefilo-compact-lists D2): NFD, no combining marks, lower-case, collapsed whitespace, trimmed. */
export function normalise(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when the normalised query is a substring of the normalised title; an empty query matches everything. */
export function matchesQuery(title: string, query: string): boolean {
  const q = normalise(query);
  return q === '' || normalise(title).includes(q);
}
