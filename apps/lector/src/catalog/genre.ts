// Research R10: ordered keyword table; earlier rows win, so specific genres come first.
const TABLE: readonly (readonly [string, readonly string[]])[] = [
  ['Science Fiction', ['science fiction', 'science-fiction', 'sci-fi', 'ciencia-ficción', 'ciencia ficción']],
  ['Fantasy', ['fantasy', 'fantasía']],
  ['Mystery & Thriller', ['mystery', 'thriller', 'detective', 'crime', 'suspense', 'novela negra']],
  ['Romance', ['romance']],
  ['Horror', ['horror', 'terror']],
  ['Historical Fiction', ['historical fiction', 'novela histórica']],
  ['Biography & Memoir', ['biography', 'autobiography', 'memoir', 'biografía']],
  ['History', ['history', 'historia']],
  ['Science', ['science', 'physics', 'biology', 'astronomy', 'ciencia']],
  ['Philosophy', ['philosophy', 'filosofía']],
  ['Psychology', ['psychology', 'psicología']],
  ['Business & Economics', ['business', 'economics', 'management', 'economía']],
  ['Self-Help', ['self-help', 'personal development', 'autoayuda']],
  ['Poetry', ['poetry', 'poesía']],
  ['Fiction', ['fiction', 'ficción', 'novela', 'novel']],
];

export function genreFromSubjects(subjects: readonly string[]): string | null {
  const lower = subjects.map((s) => s.toLowerCase());
  for (const [genre, keywords] of TABLE) {
    if (lower.some((s) => keywords.some((k) => s.includes(k)))) return genre;
  }
  return null;
}
