# Contract: Catalog lookup (apps/pwa/src/catalog)

This is shell code: it calls `fetch`, which is injected for tests. It never writes to
the DB; callers turn results into commands.

```ts
type Fetch = typeof fetch;

interface BookDetails {
  title: string | null;
  authors: string[];                 // joined for display as "A, B & C" (spec edge case)
  totalPages: number | null;         // integer 1..10000, else null (research R11)
  genre: string | null;              // genreFromSubjects (research R10)
  coverUrl: string | null;           // https only
  firstPublishYear: number | null;
  source: 'openlibrary' | 'googlebooks';
}

type LookupOutcome =
  | { kind: 'found'; details: BookDetails }
  | { kind: 'notFound' }
  | { kind: 'unavailable'; reason: 'offline' | 'network' | 'http'; status?: number }
  | { kind: 'timeout' };

function lookupIsbn(isbn: Isbn13, deps: { fetch: Fetch; online: () => boolean; timeoutMs?: number /* 8000 */ }): Promise<LookupOutcome>;

interface SearchHit extends BookDetails { key: string; isbn: Isbn13 | null }
type SearchOutcome =
  | { kind: 'results'; hits: SearchHit[] }       // 0..20; an empty list means "no matches"
  | { kind: 'unavailable' } | { kind: 'timeout' };

function searchTitle(query: string /* trimmed, ≥ 3 chars */, deps: { fetch: Fetch; online: () => boolean; timeoutMs?: number }): Promise<SearchOutcome>;

function authorsLabel(authors: string[]): string | null;   // [] → null; ["A"] → "A"; ["A","B"] → "A & B"; ["A","B","C"] → "A, B & C"
```

## Requests

All requests use `{ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal }`.
The only variable data sent is the ISBN or the query text (FR-013).

| # | URL | Used for |
|---|---|---|
| 1 | `https://openlibrary.org/search.json?isbn={isbn}&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject&limit=1` | ISBN lookup, in parallel with #2 |
| 2 | `https://openlibrary.org/isbn/{isbn}.json` (follows the 302) | exact pages and the edition cover. A 404 is not an error |
| 3 | `https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}&maxResults=1` | only if #1 has no doc |
| 4 | `https://openlibrary.org/search.json?q={query}&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject,isbn&limit=20` | title search |
| 5 | `https://www.googleapis.com/books/v1/volumes?q={query}&maxResults=20` | title search, only if #4 fails (not merely empty) |

## Merge rules (`lookupIsbn`)

1. `title` and `authors` come from #1, or else #3.
2. `totalPages`: the edition's `number_of_pages` from #2, else #1's
   `number_of_pages_median`, else #3's `pageCount`. Every value passes the 1..10000 check.
3. `coverUrl`: the edition `covers[0]` from #2, else #1's `cover_i`, each as
   `https://covers.openlibrary.org/b/id/{id}-L.jpg`, else #3's
   `imageLinks.thumbnail`, rewritten to https. Negative or zero ids are ignored.
4. `genre`: `genreFromSubjects(#1.subject ?? #3.categories ?? [])`.
5. Outcome classification follows research R2. #2 failing never downgrades a `found`
   from #1.

## Cover download

```ts
function fetchCover(url: string, deps: { fetch: Fetch; timeoutMs?: number /* 8000 */ }): Promise<Blob | null>;
```

- It returns null on a non-2xx response, a non-`image/*` content type, or a body
  smaller than 1 KB (a placeholder).
- The DB worker enforces the dimension check and the downscaling.

## Test fixtures

JSON recorded from the live endpoints goes in `apps/pwa/src/catalog/fixtures/`:

- `ol-search-isbn-<isbn>.json`, `ol-edition-<isbn>.json`, for the 6 ISBNs in research R1;
- `ol-search-isbn-miss.json` (`{"docs":[]}`);
- `gb-isbn-<isbn>.json` (one, recorded when quota allows, or hand-written from the
  documented schema);
- `ol-search-q-left-hand.json`.

Unit tests cover every merge rule, every outcome, and the page-count and cover
filters, using a fake `fetch` that serves these fixtures.
