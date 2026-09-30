# Contract: Capture link, payload and article commands

## Capture link (iPhone Shortcut → Readerlog in Chrome)

```
https://<app>/#/capture?d=<URL-encoded Base64 of the JSON payload>
```

- **Encoding.** Both standard Base64 (`+/`, with padding, possibly with line breaks,
  as Shortcuts produces it) and base64url MUST be accepted. Whitespace is stripped
  before decoding.
- **Payload.** It is `{ v: 1, url, title?, author?, words?, at }`:
  - `url`: required. It must normalize (research R6).
  - `at`: required, an ISO 8601 date-time. It may carry an offset, as Shortcuts
    produces it; it is converted to a UTC instant.
  - `title`: optional; trimmed and cut to 500 characters. An empty title falls back to
    the site.
  - `author`: optional; trimmed and cut to 200 characters.
  - `words`: optional; a number, or a numeric string. Anything that isn't an integer in
    0..100000 becomes null, and **0 becomes null** ("couldn't count").
  - An unknown `v`, bad Base64, bad JSON or a bad `url` or `at` means **nothing is
    saved**, and the screen shows "This capture link is damaged" with **Add article**
    (US2·4).
- **`read_on`** is the local date of the device opening the link, at the time it is
  opened (`todayLocal()`).
- **The `/capture` screen:**
  1. It parses the payload.
  2. It checks `findArticleByUrl`. If a match exists, it shows "Already logged on
     <date>" with **Log again** or **Cancel** (FR-008).
  3. It dispatches `AddArticle` with the derived id (research R5). An `AlreadyExists`
     answer is shown as "Already saved", with no second save (FR-010).
  4. It shows "Logged: <title> · <site> · ~N min" with **Undo** for 6 s and **Done**.
  5. If sync is on, it runs `sync('manual')` straight away (research R1). If sync is
     off, it shows the "Finish setup" join prompt.

## Commands (`packages/core`)

| Command | Payload | Changes | Rejections |
|---|---|---|---|
| `AddArticle` | `itemId, url, title, author?, wordCount?, readOn, detailsStatus: 'complete' \| 'notFound'` | insert an `items` row: `type='article'`, normalized `url`, `domain`, `title`, `author`, `word_count`, `read_on`, `metadata_status` (`ok` or `failed`), `created_at=now` | `InvalidInput` (id, readOn, wordCount), `InvalidUrl`, `TitleRequired`, `AlreadyExists` |
| `EditArticle` | `itemId, title?, author?, readOn?` | only the fields that changed | `NotFound` (missing, removed, or not an article), `TitleRequired`, `InvalidInput` |
| `RemoveArticle` | `itemId` | `deleted_at=now`. An already-removed article gives no changes | `NotFound` (missing or not an article) |

**Invariants** (core tests):

- **A-1.** Adding the same `AddArticle` twice gives `AlreadyExists` the second time.
- **A-2.** Book commands on an article give `NotFound`, and article commands on a book
  give `NotFound`.
- **A-3.** The article's `url` always equals `normalizeUrl(input)`, and its `domain` is
  that URL's host without `www.`.

## Pure helpers (`packages/core`)

```ts
function normalizeUrl(input: string): Result<NormalizedUrl, ParseError>;   // research R6
function siteOf(url: NormalizedUrl): string;
function stampOps(changes: readonly Change[], s: { hlc: Hlc | null; deviceId: DeviceId; wallMs: number; newOpId: () => string }):
  { ops: OpWire[]; hlc: Hlc | null };                                             // research R7; same stamping rule as applyChanges
function readingMinutes(words: number | null): number | null;             // ceil(words / 238)
function articleStats(articles: readonly Article[], opts: { year: number; today: LocalDate }): ArticleStats;
```

**URL normalization test vectors** (`packages/core/test/url.test.ts`):

| Input | Output |
|---|---|
| `HTTPS://WWW.Example.com:443/a?utm_source=x&b=1#top` | `https://www.example.com/a?b=1`, site `example.com` |
| `http://example.com/?fbclid=1&gclid=2` | `http://example.com/` |
| `https://example.com/p?ref=hn&id=7` | `https://example.com/p?id=7` |
| `ftp://example.com/x` | error `InvalidUrl` |
| `not a url` | error `InvalidUrl` |
| `https://blog.example.com/x?si=abc` | `https://blog.example.com/x`, site `blog.example.com` |
