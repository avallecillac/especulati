// SC-002 measurement: looks up the reference ISBNs against the LIVE catalogs, sequentially.
// Manual only (never part of `pnpm test` or CI): `pnpm --filter lector catalog:coverage`.
import { readFileSync } from 'node:fs';
import { parseIsbn } from '@especulati/lector-core';
import { lookupIsbn } from '../src/catalog/isbnLookup.ts';

interface Entry {
  isbn: string;
  title: string;
  lang: 'en' | 'es';
}

const entries = JSON.parse(readFileSync(new URL('./reference-isbns.json', import.meta.url), 'utf8')) as Entry[];

const invalid = entries.filter((e) => !parseIsbn(e.isbn).ok);
if (invalid.length > 0) {
  console.error(`Invalid ISBN check digit: ${invalid.map((e) => `${e.isbn} (${e.title})`).join(', ')}`);
  process.exit(1);
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const rows: string[] = [];
let titleAuthor = 0;
let pages = 0;

for (const e of entries) {
  const parsed = parseIsbn(e.isbn);
  if (!parsed.ok) continue;
  const out = await lookupIsbn(parsed.value, { fetch: (u, i) => fetch(u, i), online: () => true });
  let title = '-';
  let author = '-';
  let pg = '-';
  let src = out.kind === 'found' ? '' : out.kind;
  if (out.kind === 'found') {
    const d = out.details;
    title = d.title ?? '-';
    author = d.authors.join(', ') || '-';
    pg = d.totalPages === null ? '-' : String(d.totalPages);
    src = d.source;
    if (d.title && d.authors.length > 0) titleAuthor++;
    if (d.totalPages !== null) pages++;
  }
  rows.push(`${e.isbn}  ${e.lang}  ${pad(e.title, 30)}  ${pad(title, 30)}  ${pad(author, 24)}  ${pad(pg, 5)}  ${src}`);
}

console.log(`${'ISBN'.padEnd(13)}  ln  ${pad('expected', 30)}  ${pad('found title', 30)}  ${pad('author', 24)}  ${pad('pages', 5)}  source`);
console.log(rows.join('\n'));
console.log(`\ntitle+author: ${titleAuthor}/${entries.length}, pages: ${pages}/${entries.length}`);
