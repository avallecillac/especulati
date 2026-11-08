import { err, ok, type Result } from './result.ts';
import type {
  BooksSnapshot, BookSnapshot, Change, Command, Decision, FieldValue, HighlightSnapshot, ItemTagRow, ReconcileSnapshot, Rejection, TagMove, TagSnapshot,
} from './commands.ts';
import { isHighlightId, normalizeNote, normalizeQuote } from './highlight.ts';
import { tagKey, tagName, TAGS_PER_ARTICLE_MAX } from './tags.ts';
import { deriveStatus, detailsStatusToDb, maxLoggedPage, type BookStatus, type EventType, type Item, type ReadingEvent } from './book.ts';
import { parseWordCount } from './article.ts';
import { normalizeUrl, siteOf } from './url.ts';
import {
  parseAuthor, parseCoverUrl, parseEventId, parseGenre, parseIsbn, parseItemId, parseLocalDate, parsePage, parsePageCount, parseTitle,
  UUID_PATTERN, type CoverUrl, type Instant, type Isbn13, type ParseError,
} from './types.ts';

type Decided = Result<Decision, Rejection>;

const invalid = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: e.field, reason: e.reason });
const decided = (changes: Change[], offerFinish = false): Decided => ok({ changes, offerFinish });

/** Parse, or short-circuit with the mapped rejection. */
function need<T>(r: Result<T, ParseError>, onError: (e: ParseError) => Rejection = invalid): Result<T, Rejection> {
  return r.ok ? r : err(onError(r.error));
}

const titleRejection = (e: ParseError): Rejection => (e.reason === 'required' ? { kind: 'TitleRequired' } : invalid(e));
const isbnRejection = (): Rejection => ({ kind: 'InvalidIsbn' });
const pageCountRejection = (): Rejection => ({ kind: 'InvalidPageCount' });

function addBook(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'AddBook' }>, now: Instant): Decided {
  const id = need(parseItemId(cmd.itemId));
  if (!id.ok) return id;
  if (snapshot) return err({ kind: 'AlreadyExists' });
  let isbn: Isbn13 | null = null;
  if (cmd.isbn !== undefined && cmd.isbn !== null) {
    const i = need(parseIsbn(cmd.isbn), isbnRejection);
    if (!i.ok) return i;
    isbn = i.value;
  }
  // FR-007: a blank title with an ISBN becomes the placeholder `ISBN <isbn13>`.
  const title = need(parseTitle(cmd.title.trim() === '' && isbn !== null ? `ISBN ${isbn}` : cmd.title), titleRejection);
  if (!title.ok) return title;
  let coverUrl: CoverUrl | null = null;
  if (cmd.coverUrl !== undefined && cmd.coverUrl !== null) {
    const c = need(parseCoverUrl(cmd.coverUrl));
    if (!c.ok) return c;
    coverUrl = c.value;
  }
  const author = need(parseAuthor(cmd.author));
  if (!author.ok) return author;
  const genre = need(parseGenre(cmd.genre));
  if (!genre.ok) return genre;
  let totalPages: number | null = null;
  if (cmd.totalPages !== undefined && cmd.totalPages !== null) {
    const p = need(parsePageCount(cmd.totalPages), pageCountRejection);
    if (!p.ok) return p;
    totalPages = p.value;
  }
  const localDate = need(parseLocalDate(cmd.localDate));
  if (!localDate.ok) return localDate;

  const fields: Record<string, FieldValue> = { type: 'book', title: title.value };
  if (author.value !== null) fields['author'] = author.value;
  if (totalPages !== null) fields['total_pages'] = totalPages;
  if (genre.value !== null) fields['genre'] = genre.value;
  if (isbn !== null) fields['isbn'] = isbn;
  if (coverUrl !== null) fields['cover_url'] = coverUrl;
  fields['metadata_status'] = detailsStatusToDb(cmd.detailsStatus ?? 'complete');
  fields['created_at'] = now;
  const changes: Change[] = [{ tbl: 'items', rowId: id.value, fields }];

  if (cmd.startNow) {
    if (cmd.startEventId === undefined) return err({ kind: 'InvalidInput', field: 'startEventId', reason: 'required when startNow' });
    const eventId = need(parseEventId(cmd.startEventId));
    if (!eventId.ok) return eventId;
    changes.push(eventInsert(eventId.value, id.value, 'started', null, now, localDate.value));
  }
  return decided(changes);
}

/** An event insert carries all of the event's fields (contracts/change-log.md "Complete"). */
function eventInsert(eventId: string, itemId: string, type: string, page: number | null, now: Instant, localDate: string): Change {
  return {
    tbl: 'reading_events',
    rowId: eventId,
    fields: { item_id: itemId, event_type: type, page, occurred_at: now, local_date: localDate },
  };
}

/** Which statuses each event may follow (data-model.md "State transitions"). */
const ALLOWED_FROM: Record<EventType, readonly BookStatus[]> = {
  started: ['queued', 'finished', 'abandoned'],
  progress: ['queued', 'reading', 'finished', 'abandoned'],
  finished: ['reading'],
  abandoned: ['reading'],
};

/** A live (non-removed) book of the snapshot, or NotFound. */
function liveBook(snapshot: BookSnapshot | null): Result<BookSnapshot, Rejection> {
  return snapshot && snapshot.item.deletedAt === null && snapshot.item.type === 'book' ? ok(snapshot) : err({ kind: 'NotFound' });
}

function logEvent(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'LogEvent' }>, now: Instant): Decided {
  const book = liveBook(snapshot);
  if (!book.ok) return book;
  const { item, events } = book.value;
  const eventId = need(parseEventId(cmd.eventId));
  if (!eventId.ok) return eventId;
  if (events.some((e) => e.id === eventId.value)) return err({ kind: 'AlreadyExists' });
  const localDate = need(parseLocalDate(cmd.localDate));
  if (!localDate.ok) return localDate;

  let page: number | null = null;
  let pageEventId: string | null = null;
  if (cmd.page !== undefined && cmd.page !== null) {
    if (cmd.type !== 'progress' && cmd.type !== 'abandoned') return err({ kind: 'PageNotAllowed' });
    if (cmd.type === 'abandoned') {
      // 003 commands contract: an abandon at a page carries its own id for the progress entry.
      if (cmd.pageEventId === undefined) return err({ kind: 'PageNotAllowed' });
      const pid = need(parseEventId(cmd.pageEventId), () => ({ kind: 'InvalidInput', field: 'pageEventId', reason: 'not a lowercase uuid' }));
      if (!pid.ok) return pid;
      if (pid.value === eventId.value) return err({ kind: 'InvalidInput', field: 'pageEventId', reason: 'same as eventId' });
      if (events.some((e) => e.id === pid.value)) return err({ kind: 'AlreadyExists' });
      pageEventId = pid.value;
    }
    const p = need(parsePage(cmd.page), () => ({ kind: 'InvalidPage' }));
    if (!p.ok) return p;
    if (item.totalPages !== null && p.value > item.totalPages) return err({ kind: 'PageBeyondEnd', totalPages: item.totalPages });
    page = p.value;
  }

  const from = deriveStatus(events);
  if (!ALLOWED_FROM[cmd.type].includes(from)) return err({ kind: 'InvalidTransition', from, type: cmd.type });

  if (pageEventId !== null) {
    return decided([
      eventInsert(pageEventId, item.id, 'progress', page, now, localDate.value),
      eventInsert(eventId.value, item.id, 'abandoned', null, now, localDate.value),
    ]);
  }
  const offerFinish = page !== null && page === item.totalPages;
  return decided([eventInsert(eventId.value, item.id, cmd.type, page, now, localDate.value)], offerFinish);
}

function editBook(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'EditBook' }>): Decided {
  const book = liveBook(snapshot);
  if (!book.ok) return book;
  const { item, events } = book.value;
  const fields: Record<string, FieldValue> = {};

  if (cmd.title !== undefined) {
    const title = need(parseTitle(cmd.title), titleRejection);
    if (!title.ok) return title;
    if (title.value !== item.title) fields['title'] = title.value;
  }
  if (cmd.author !== undefined) {
    const author = need(parseAuthor(cmd.author));
    if (!author.ok) return author;
    if (author.value !== item.author) fields['author'] = author.value;
  }
  if (cmd.genre !== undefined) {
    const genre = need(parseGenre(cmd.genre));
    if (!genre.ok) return genre;
    if (genre.value !== item.genre) fields['genre'] = genre.value;
  }
  if (cmd.isbn !== undefined) {
    let isbn: Isbn13 | null = null;
    if (cmd.isbn !== null) {
      const i = need(parseIsbn(cmd.isbn), isbnRejection);
      if (!i.ok) return i;
      isbn = i.value;
    }
    if (isbn !== item.isbn) fields['isbn'] = isbn;
  }
  if (cmd.coverUrl !== undefined) {
    let coverUrl: CoverUrl | null = null;
    if (cmd.coverUrl !== null) {
      const c = need(parseCoverUrl(cmd.coverUrl));
      if (!c.ok) return c;
      coverUrl = c.value;
    }
    if (coverUrl !== item.coverUrl) fields['cover_url'] = coverUrl;
  }
  if (cmd.detailsStatus !== undefined && cmd.detailsStatus !== item.detailsStatus)
    fields['metadata_status'] = detailsStatusToDb(cmd.detailsStatus);
  if (cmd.totalPages !== undefined) {
    let totalPages: number | null = null;
    if (cmd.totalPages !== null) {
      const p = need(parsePageCount(cmd.totalPages), pageCountRejection);
      if (!p.ok) return p;
      const maxLogged = maxLoggedPage(events);
      if (maxLogged !== null && p.value < maxLogged) return err({ kind: 'PagesBelowLogged', maxLogged });
      totalPages = p.value;
    }
    if (totalPages !== item.totalPages) fields['total_pages'] = totalPages;
  }
  return decided(Object.keys(fields).length > 0 ? [{ tbl: 'items', rowId: item.id, fields }] : []);
}

/**
 * Retry path (FR-009): fills only still-empty fields, so it can never overwrite what the user set.
 * Invalid catalog values are skipped, never rejected, so the pending status always clears.
 */
function fillDetails(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'FillDetails' }>): Decided {
  const id = need(parseItemId(cmd.itemId));
  if (!id.ok) return id;
  if (cmd.outcome !== 'found' && cmd.outcome !== 'notFound') return err({ kind: 'InvalidInput', field: 'outcome', reason: 'must be found or notFound' });
  const book = liveBook(snapshot);
  if (!book.ok) return book;
  const { item, events } = book.value;
  if (item.detailsStatus !== 'pending') return decided([]);
  if (cmd.outcome === 'notFound') return decided([{ tbl: 'items', rowId: item.id, fields: { metadata_status: 'failed' } }]);

  const d = cmd.details ?? {};
  const fields: Record<string, FieldValue> = { metadata_status: 'ok' };
  if (d.title !== undefined && item.isbn !== null && item.title === `ISBN ${item.isbn}`) {
    const t = parseTitle(d.title);
    if (t.ok) fields['title'] = t.value;
  }
  if (d.author != null && item.author === null) {
    const a = parseAuthor(d.author);
    if (a.ok && a.value !== null) fields['author'] = a.value;
  }
  if (d.genre != null && item.genre === null) {
    const g = parseGenre(d.genre);
    if (g.ok && g.value !== null) fields['genre'] = g.value;
  }
  if (d.coverUrl != null && item.coverUrl === null) {
    const c = parseCoverUrl(d.coverUrl);
    if (c.ok) fields['cover_url'] = c.value;
  }
  if (d.totalPages != null && item.totalPages === null) {
    const p = parsePageCount(d.totalPages);
    const maxLogged = maxLoggedPage(events);
    if (p.ok && (maxLogged === null || p.value >= maxLogged)) fields['total_pages'] = p.value;
  }
  return decided([{ tbl: 'items', rowId: item.id, fields }]);
}

function removeBook(snapshot: BookSnapshot | null, now: Instant): Decided {
  if (!snapshot || snapshot.item.type !== 'book') return err({ kind: 'NotFound' });
  if (snapshot.item.deletedAt !== null) return decided([]);
  return decided([{ tbl: 'items', rowId: snapshot.item.id, fields: { deleted_at: now } }]);
}

const readOnRejection = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: 'readOn', reason: e.reason });
const wordCountRejection = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: 'wordCount', reason: e.reason });

/** Contract: contracts/capture.md "AddArticle". Articles have no events. */
function addArticle(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'AddArticle' }>, now: Instant): Decided {
  const id = need(parseItemId(cmd.itemId));
  if (!id.ok) return id;
  if (snapshot) return err({ kind: 'AlreadyExists' });
  const title = need(parseTitle(cmd.title), titleRejection);
  if (!title.ok) return title;
  const url = need(normalizeUrl(cmd.url), () => ({ kind: 'InvalidUrl' }));
  if (!url.ok) return url;
  const author = need(parseAuthor(cmd.author));
  if (!author.ok) return author;
  let wordCount: number | null = null;
  if (cmd.wordCount !== undefined && cmd.wordCount !== null) {
    const w = need(parseWordCount(cmd.wordCount), wordCountRejection);
    if (!w.ok) return w;
    wordCount = w.value;
  }
  // 008: no readOn means a saved article. `read_on: null` is emitted explicitly because tierOf keys on it.
  let readOn: string | null = null;
  if (cmd.readOn !== undefined) {
    const r = need(parseLocalDate(cmd.readOn), readOnRejection);
    if (!r.ok) return r;
    readOn = r.value;
  }
  if (cmd.detailsStatus !== 'complete' && cmd.detailsStatus !== 'notFound')
    return err({ kind: 'InvalidInput', field: 'detailsStatus', reason: 'must be complete or notFound' });

  return decided([
    {
      tbl: 'items',
      rowId: id.value,
      fields: {
        type: 'article',
        title: title.value,
        author: author.value,
        url: url.value,
        domain: siteOf(url.value),
        word_count: wordCount,
        read_on: readOn,
        metadata_status: detailsStatusToDb(cmd.detailsStatus),
        created_at: now,
      },
    },
  ]);
}

/** A live (non-removed) article of the snapshot, or NotFound. */
function liveArticle(snapshot: BookSnapshot | null): Result<BookSnapshot, Rejection> {
  return snapshot && snapshot.item.deletedAt === null && snapshot.item.type === 'article' ? ok(snapshot) : err({ kind: 'NotFound' });
}

function editArticle(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'EditArticle' }>): Decided {
  const found = liveArticle(snapshot);
  if (!found.ok) return found;
  const { item } = found.value;
  const fields: Record<string, FieldValue> = {};
  if (cmd.title !== undefined) {
    const title = need(parseTitle(cmd.title), titleRejection);
    if (!title.ok) return title;
    if (title.value !== item.title) fields['title'] = title.value;
  }
  if (cmd.author !== undefined) {
    const author = need(parseAuthor(cmd.author));
    if (!author.ok) return author;
    if (author.value !== item.author) fields['author'] = author.value;
  }
  if (cmd.readOn !== undefined) {
    const readOn = need(parseLocalDate(cmd.readOn), readOnRejection);
    if (!readOn.ok) return readOn;
    if (readOn.value !== item.readOn) fields['read_on'] = readOn.value;
  }
  return decided(Object.keys(fields).length > 0 ? [{ tbl: 'items', rowId: item.id, fields }] : []);
}

function removeArticle(snapshot: BookSnapshot | null, now: Instant): Decided {
  if (!snapshot || snapshot.item.type !== 'article') return err({ kind: 'NotFound' });
  if (snapshot.item.deletedAt !== null) return decided([]);
  return decided([{ tbl: 'items', rowId: snapshot.item.id, fields: { deleted_at: now } }]);
}

/** Removal tombstones the event; it is never erased (FR-009, constitution III). */
function removeEvent(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'RemoveEvent' }>, now: Instant): Decided {
  const book = liveBook(snapshot);
  if (!book.ok) return book;
  const target = book.value.events.find((e) => e.id === cmd.eventId);
  if (!target) return err({ kind: 'NotFound' });
  if (target.deletedAt !== null) return decided([]);
  return decided([{ tbl: 'reading_events', rowId: target.id, fields: { deleted_at: now } }]);
}

/** Both live books must be plain books; a sweep accepts a removed duplicate whose merged_into chain reaches the survivor. */
function chainReaches(books: ReadonlyMap<string, BookSnapshot>, from: BookSnapshot, target: string): boolean {
  const seen = new Set<string>([from.item.id]);
  let cur = from.item.mergedInto;
  while (cur !== null && !seen.has(cur)) {
    if (cur === target) return true;
    seen.add(cur);
    cur = books.get(cur)?.item.mergedInto ?? null;
  }
  return false;
}

const copiesInvalid = (reason: string): Rejection => ({ kind: 'InvalidInput', field: 'copies', reason });

/** Contract: contracts/commands-004.md "MergeBooks". Events are copied, never edited in place. */
function mergeBooks(snapshot: BooksSnapshot | null, cmd: Extract<Command, { kind: 'MergeBooks' }>, now: Instant): Decided {
  const sid = need(parseItemId(cmd.survivorId), () => ({ kind: 'InvalidInput', field: 'survivorId', reason: 'not a lowercase uuid' }));
  if (!sid.ok) return sid;
  const did = need(parseItemId(cmd.duplicateId), () => ({ kind: 'InvalidInput', field: 'duplicateId', reason: 'not a lowercase uuid' }));
  if (!did.ok) return did;
  const byId = new Map((snapshot?.books ?? []).map((b) => [b.item.id as string, b]));
  const survivor = byId.get(sid.value);
  const duplicate = byId.get(did.value);
  if (!survivor || !duplicate || survivor.item.deletedAt !== null || survivor.item.type !== 'book' || duplicate.item.type !== 'book') return err({ kind: 'NotFound' });
  const sweep = duplicate.item.deletedAt !== null;
  if (sweep && !chainReaches(byId, duplicate, sid.value)) return err({ kind: 'NotFound' });
  if (sid.value === did.value) return err({ kind: 'InvalidInput', field: 'duplicateId', reason: 'same as survivorId' });
  if (!sweep) {
    const s = survivor.item;
    const d = duplicate.item;
    const survivorIsEarlier = s.createdAt !== d.createdAt ? s.createdAt < d.createdAt : s.id < d.id;
    if (!survivorIsEarlier) return err({ kind: 'InvalidInput', field: 'survivorId', reason: 'not earliest' });
  }

  const liveIds = duplicate.events.filter((e) => e.deletedAt === null).map((e) => e.id as string);
  const froms = cmd.copies.map((c) => c.from);
  if (froms.length !== liveIds.length || new Set(froms).size !== froms.length || !liveIds.every((id) => froms.includes(id)))
    return err(copiesInvalid('from must be exactly the duplicate live event ids'));
  // A `to` already on the survivor means another device copied the same entry: skip that insert.
  const onSurvivor = new Set(survivor.events.map((e) => e.id as string));
  const elsewhere = new Set([...byId.values()].filter((b) => b !== survivor).flatMap((b) => b.events.map((e) => e.id as string)));
  const bySource = new Map(duplicate.events.map((e) => [e.id as string, e]));
  // Copy ids are content-addressed (research R8), so identical entries share a `to`: insert it once.
  const sameContent = (a: ReadingEvent, b: ReadingEvent) =>
    a.type === b.type && a.page === b.page && a.occurredAt === b.occurredAt && a.localDate === b.localDate;
  const tos = new Map<string, ReadingEvent>();
  for (const c of cmd.copies) {
    if (!parseEventId(c.to).ok) return err(copiesInvalid('to is not a lowercase uuid'));
    if (elsewhere.has(c.to)) return err(copiesInvalid('to exists on another book'));
    const src = bySource.get(c.from)!;
    const prev = tos.get(c.to);
    if (prev && !sameContent(prev, src)) return err(copiesInvalid('to is repeated for different entries'));
    tos.set(c.to, src);
  }
  const changes: Change[] = [];
  const inserted = new Set<string>();
  for (const c of cmd.copies) {
    if (onSurvivor.has(c.to) || inserted.has(c.to)) continue;
    inserted.add(c.to);
    const e = bySource.get(c.from)!;
    changes.push({
      tbl: 'reading_events',
      rowId: c.to,
      fields: { item_id: sid.value, event_type: e.type, page: e.page, occurred_at: e.occurredAt, local_date: e.localDate },
    });
  }
  for (const c of cmd.copies) changes.push({ tbl: 'reading_events', rowId: c.from, fields: { deleted_at: now } });
  if (sweep) return decided(changes);

  // FillDetails rule: only still-empty fields; total_pages must not fall below a page already logged.
  const s = survivor.item;
  const d = duplicate.item;
  const fill: Record<string, FieldValue> = {};
  if (s.author === null && d.author !== null) fill['author'] = d.author;
  if (s.totalPages === null && d.totalPages !== null) {
    const maxLogged = maxLoggedPage([...survivor.events, ...duplicate.events]);
    if (maxLogged === null || d.totalPages >= maxLogged) fill['total_pages'] = d.totalPages;
  }
  if (s.genre === null && d.genre !== null) fill['genre'] = d.genre;
  if (s.isbn === null && d.isbn !== null) fill['isbn'] = d.isbn;
  if (s.coverUrl === null && d.coverUrl !== null) fill['cover_url'] = d.coverUrl;
  if (Object.keys(fill).length > 0) changes.push({ tbl: 'items', rowId: s.id, fields: fill });
  changes.push({ tbl: 'items', rowId: d.id, fields: { deleted_at: now, merged_into: sid.value } });
  return decided(changes);
}

function dismissDuplicate(snapshot: BooksSnapshot | null, cmd: Extract<Command, { kind: 'DismissDuplicate' }>, now: Instant): Decided {
  const field = (name: string) => (): Rejection => ({ kind: 'InvalidInput', field: name, reason: 'not a lowercase uuid' });
  const id = need(parseItemId(cmd.dismissalId), field('dismissalId'));
  if (!id.ok) return id;
  const a = need(parseItemId(cmd.itemA), field('itemA'));
  if (!a.ok) return a;
  const b = need(parseItemId(cmd.itemB), field('itemB'));
  if (!b.ok) return b;
  if (a.value === b.value) return err({ kind: 'InvalidInput', field: 'itemB', reason: 'same as itemA' });
  if (snapshot?.dismissals?.some((d) => d.id === id.value && d.deletedAt === null)) return decided([]);
  const [lo, hi] = a.value < b.value ? [a.value, b.value] : [b.value, a.value];
  return decided([{ tbl: 'duplicate_dismissals', rowId: id.value, fields: { item_a: lo, item_b: hi, created_at: now } }]);
}

const highlightIdInvalid = (): Rejection => ({ kind: 'InvalidInput', field: 'highlightId', reason: 'not a lowercase uuid' });

/** Contract: contracts/commands-007.md. Quote and note are normalised (R3); at least one must remain. */
function addHighlight(snapshot: HighlightSnapshot | null, cmd: Extract<Command, { kind: 'AddHighlight' }>, now: Instant): Decided {
  if (!isHighlightId(cmd.highlightId)) return err(highlightIdInvalid());
  const itemId = need(parseItemId(cmd.itemId));
  if (!itemId.ok) return itemId;
  const localDate = need(parseLocalDate(cmd.localDate));
  if (!localDate.ok) return localDate;
  const item = snapshot?.item ?? null;
  if (item === null || item.id !== itemId.value || item.deletedAt !== null) return err({ kind: 'NotFound' });
  let page: number | null = null;
  if (cmd.page !== undefined && cmd.page !== null) {
    if (item.type !== 'book') return err({ kind: 'InvalidInput', field: 'page', reason: 'only books have pages' });
    const p = need(parsePage(cmd.page));
    if (!p.ok) return p;
    page = p.value;
  }
  if (snapshot!.highlight !== null) return err({ kind: 'AlreadyExists' });
  const quote = normalizeQuote(cmd.quote ?? '');
  if (!quote.ok) return err({ kind: 'TooLong', field: 'quote', max: quote.error.max });
  const note = normalizeNote(cmd.note ?? '');
  if (!note.ok) return err({ kind: 'TooLong', field: 'note', max: note.error.max });
  if (quote.value === null && note.value === null) return err({ kind: 'HighlightEmpty' });
  return decided([
    {
      tbl: 'highlights',
      rowId: cmd.highlightId,
      fields: { item_id: item.id, quote: quote.value, note: note.value, page, created_at: now, local_date: localDate.value },
    },
  ]);
}

function editHighlightNote(snapshot: HighlightSnapshot | null, cmd: Extract<Command, { kind: 'EditHighlightNote' }>): Decided {
  const h = snapshot?.highlight ?? null;
  if (h === null || h.deletedAt !== null) return err({ kind: 'NotFound' });
  const note = normalizeNote(cmd.note);
  if (!note.ok) return err({ kind: 'TooLong', field: 'note', max: note.error.max });
  if (note.value === null && h.quote === null) return err({ kind: 'HighlightEmpty' });
  if (note.value === h.note) return decided([]);
  return decided([{ tbl: 'highlights', rowId: h.id, fields: { note: note.value } }]);
}

/** Remove and Restore are idempotent LWW writes of `deleted_at`. */
function setHighlightRemoved(snapshot: HighlightSnapshot | null, removedAt: Instant | null): Decided {
  const h = snapshot?.highlight ?? null;
  if (h === null) return err({ kind: 'NotFound' });
  if ((h.deletedAt === null) === (removedAt === null)) return decided([]);
  return decided([{ tbl: 'highlights', rowId: h.id, fields: { deleted_at: removedAt } }]);
}

/** Every article insert field (research R2/R4, invariant S-2), so an op applied on a peer with no row yields a complete article. */
function articleRow(item: Item, readOn: string | null): Record<string, FieldValue> {
  return {
    type: 'article',
    title: item.title,
    url: item.url,
    domain: item.domain,
    author: item.author,
    word_count: item.wordCount,
    metadata_status: detailsStatusToDb(item.detailsStatus),
    created_at: item.createdAt,
    read_on: readOn,
  };
}

/** Contract: contracts/commands-008.md "MarkArticleRead". One base op that carries the whole row (S-2). */
function markArticleRead(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'MarkArticleRead' }>): Decided {
  const found = liveArticle(snapshot);
  if (!found.ok) return found;
  const readOn = need(parseLocalDate(cmd.readOn), readOnRejection);
  if (!readOn.ok) return readOn;
  const { item } = found.value;
  if (item.readOn !== null) return err({ kind: 'AlreadyRead' });
  return decided([{ tbl: 'items', rowId: item.id, fields: articleRow(item, readOn.value) }]);
}

/** `read_on = null` is the `s` tier. */
function markArticleUnread(snapshot: BookSnapshot | null): Decided {
  const found = liveArticle(snapshot);
  if (!found.ok) return found;
  const { item } = found.value;
  if (item.readOn === null) return err({ kind: 'NotRead' });
  return decided([{ tbl: 'items', rowId: item.id, fields: { read_on: null } }]);
}

const UUID_RE = new RegExp(`^${UUID_PATTERN}$`);
const badUuid = (field: string): Rejection => ({ kind: 'InvalidInput', field, reason: 'not a lowercase uuid' });
const nameRejection = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: 'name', reason: e.reason });
const byFrom = (a: TagMove, b: TagMove): number => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0);

/**
 * Move assignments to `destTagId`/`destItemId` (RenameTag merge and Reconcile). `moves` must name exactly the
 * source's live assignments. Writes first (insert or restore each `to`, ordered by `from`), then the `from`
 * tombstones, so the changes do not depend on the order the shell listed things in (R-1).
 */
function moveAssignments(
  field: string,
  moves: readonly TagMove[],
  sourceLive: readonly ItemTagRow[],
  destRows: readonly ItemTagRow[],
  dest: (src: ItemTagRow) => { readonly itemId: string; readonly tagId: string },
  now: Instant,
): Result<Change[], Rejection> {
  const bad = (reason: string): Rejection => ({ kind: 'InvalidInput', field, reason });
  const froms = moves.map((m) => m.from);
  if (froms.length !== sourceLive.length || new Set(froms).size !== froms.length || !sourceLive.every((a) => froms.includes(a.id)))
    return err(bad('from must be exactly the source live assignment ids'));
  if (new Set(moves.map((m) => m.to)).size !== moves.length) return err(bad('to is repeated'));
  const writes: Change[] = [];
  const tombstones: Change[] = [];
  for (const m of [...moves].sort(byFrom)) {
    const src = sourceLive.find((a) => a.id === m.from)!;
    const d = dest(src);
    if (!UUID_RE.test(m.to)) return err(bad('to is not a lowercase uuid'));
    if (m.itemId !== d.itemId) return err(bad('itemId does not match the destination'));
    const existing = destRows.find((a) => a.id === m.to);
    if (existing) {
      if (existing.itemId !== d.itemId || existing.tagId !== d.tagId) return err(bad('to belongs to another assignment'));
      if (existing.deletedAt !== null) writes.push({ tbl: 'item_tags', rowId: m.to, fields: { deleted_at: null } });
    } else {
      writes.push({ tbl: 'item_tags', rowId: m.to, fields: { item_id: d.itemId, tag_id: d.tagId, created_at: src.createdAt } });
    }
    tombstones.push({ tbl: 'item_tags', rowId: m.from, fields: { deleted_at: now } });
  }
  return ok([...writes, ...tombstones]);
}

/** Contract: contracts/commands-008.md "TagArticle". Tags are on articles only (T-1: at most 20 live per article). */
function tagArticle(snapshot: TagSnapshot | null, cmd: Extract<Command, { kind: 'TagArticle' }>, now: Instant): Decided {
  const itemId = need(parseItemId(cmd.itemId));
  if (!itemId.ok) return itemId;
  if (!UUID_RE.test(cmd.tagId)) return err(badUuid('tagId'));
  if (!UUID_RE.test(cmd.itemTagId)) return err(badUuid('itemTagId'));
  const item = snapshot?.item ?? null;
  if (item === null || item.id !== itemId.value || item.deletedAt !== null || item.type !== 'article') return err({ kind: 'NotFound' });
  const name = need(tagName(cmd.name), nameRejection);
  if (!name.ok) return name;
  const key = tagKey(name.value)!;
  const assignments = snapshot!.assignments.filter((a) => a.itemId === item.id);
  const existing = assignments.find((a) => a.id === cmd.itemTagId) ?? null;
  if (existing !== null && (existing.itemId !== item.id || existing.tagId !== cmd.tagId))
    return err({ kind: 'InvalidInput', field: 'itemTagId', reason: 'belongs to another assignment' });
  if (existing !== null && existing.deletedAt === null) return decided([]);
  const liveTags = new Set(assignments.filter((a) => a.deletedAt === null && a.tagId !== cmd.tagId).map((a) => a.tagId));
  if (liveTags.size >= TAGS_PER_ARTICLE_MAX) return err({ kind: 'TooManyTags', max: TAGS_PER_ARTICLE_MAX });

  const changes: Change[] = [];
  const tag = snapshot!.tag;
  if (tag === null) changes.push({ tbl: 'tags', rowId: cmd.tagId, fields: { name: name.value, name_key: key, created_at: now } });
  else if (tag.deletedAt !== null) changes.push({ tbl: 'tags', rowId: cmd.tagId, fields: { name: name.value, name_key: key, deleted_at: null } });
  if (existing === null) changes.push({ tbl: 'item_tags', rowId: cmd.itemTagId, fields: { item_id: item.id, tag_id: cmd.tagId, created_at: now } });
  else changes.push({ tbl: 'item_tags', rowId: cmd.itemTagId, fields: { deleted_at: null } });
  return decided(changes);
}

function untagArticle(snapshot: TagSnapshot | null, cmd: Extract<Command, { kind: 'UntagArticle' }>, now: Instant): Decided {
  if (!UUID_RE.test(cmd.itemTagId)) return err(badUuid('itemTagId'));
  const row = snapshot?.assignments.find((a) => a.id === cmd.itemTagId) ?? null;
  if (row === null) return err({ kind: 'NotFound' });
  if (row.deletedAt !== null) return decided([]);
  return decided([{ tbl: 'item_tags', rowId: row.id, fields: { deleted_at: now } }]);
}

/** A plain rename, or (with `merge`) folding the source into a live tag that already has the new key (research R3). */
function renameTag(snapshot: TagSnapshot | null, cmd: Extract<Command, { kind: 'RenameTag' }>, now: Instant): Decided {
  if (!UUID_RE.test(cmd.tagId)) return err(badUuid('tagId'));
  const source = snapshot?.tag ?? null;
  if (source === null || source.id !== cmd.tagId || source.deletedAt !== null) return err({ kind: 'NotFound' });
  const name = need(tagName(cmd.newName), nameRejection);
  if (!name.ok) return name;
  const key = tagKey(name.value)!;
  if (cmd.merge === undefined) {
    if (name.value === source.name && key === source.nameKey) return decided([]);
    return decided([{ tbl: 'tags', rowId: source.id, fields: { name: name.value, name_key: key } }]);
  }
  const bad = (reason: string): Rejection => ({ kind: 'InvalidInput', field: 'merge', reason });
  const target = snapshot!.mergeTarget;
  if (target === null || target.id !== cmd.merge.targetTagId || target.deletedAt !== null) return err(bad('target is not a live tag'));
  if (target.id === source.id) return err(bad('target is the source'));
  if (target.nameKey !== key) return err(bad('target does not have the new name'));
  const sourceLive = snapshot!.assignments.filter((a) => a.tagId === source.id && a.deletedAt === null);
  const moved = moveAssignments('merge', cmd.merge.moves, sourceLive, snapshot!.targetAssignments, (src) => ({ itemId: src.itemId, tagId: target.id }), now);
  if (!moved.ok) return moved;
  return decided([...moved.value, { tbl: 'tags', rowId: source.id, fields: { deleted_at: now } }]);
}

function deleteTag(snapshot: TagSnapshot | null, cmd: Extract<Command, { kind: 'DeleteTag' }>, now: Instant): Decided {
  if (!UUID_RE.test(cmd.tagId)) return err(badUuid('tagId'));
  const tag = snapshot?.tag ?? null;
  if (tag === null || tag.id !== cmd.tagId) return err({ kind: 'NotFound' });
  const changes: Change[] = snapshot!.assignments
    .filter((a) => a.tagId === tag.id && a.deletedAt === null)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => ({ tbl: 'item_tags' as const, rowId: a.id, fields: { deleted_at: now } }));
  if (tag.deletedAt === null) changes.push({ tbl: 'tags', rowId: tag.id, fields: { deleted_at: now } });
  return decided(changes);
}

/**
 * Contract: contracts/commands-008.md "ReconcileSavedArticle" (research R4). The older live article
 * survives, takes the duplicate's read date, highlights (copied under content-addressed ids) and tags,
 * and the duplicate is tombstoned with `merged_into`. Every list is processed in id order, so peers
 * deciding the same pair produce identical changes (R-1). A pair of two read articles is refused: a
 * re-read is not a duplicate.
 */
function reconcileSaved(snapshot: ReconcileSnapshot | null, cmd: Extract<Command, { kind: 'ReconcileSavedArticle' }>, now: Instant): Decided {
  const sid = need(parseItemId(cmd.survivorId), () => badUuid('survivorId'));
  if (!sid.ok) return sid;
  const did = need(parseItemId(cmd.duplicateId), () => badUuid('duplicateId'));
  if (!did.ok) return did;
  const s = snapshot?.survivor ?? null;
  const d = snapshot?.duplicate ?? null;
  const bad = (field: string, reason: string): Rejection => ({ kind: 'InvalidInput', field, reason });
  if (sid.value === did.value) return err(bad('duplicateId', 'same as survivorId'));
  if (s === null || s.id !== sid.value || s.type !== 'article' || s.deletedAt !== null) return err(bad('survivorId', 'not a live article'));
  if (d === null || d.id !== did.value || d.type !== 'article' || d.deletedAt !== null) return err(bad('duplicateId', 'not a live article'));
  if (s.url === null || s.url !== d.url) return err(bad('duplicateId', 'different url'));
  const survivorIsEarlier = s.createdAt !== d.createdAt ? s.createdAt < d.createdAt : s.id < d.id;
  if (!survivorIsEarlier) return err(bad('survivorId', 'not earliest'));
  if (s.readOn !== null && d.readOn !== null) return err(bad('duplicateId', 'both are read'));

  // Highlights: copies must be exactly the duplicate's live ones; ids are content-addressed by the shell.
  const live = snapshot!.duplicateHighlights.filter((h) => h.deletedAt === null);
  const froms = cmd.copies.map((c) => c.from);
  if (froms.length !== live.length || new Set(froms).size !== froms.length || !live.every((h) => froms.includes(h.id)))
    return err(copiesInvalid('from must be exactly the duplicate live highlight ids'));
  const bySource = new Map(live.map((h) => [h.id as string, h]));
  const onSurvivor = new Set(snapshot!.survivorHighlightIds);
  const sameContent = (a: (typeof live)[number], b: (typeof live)[number]) => a.quote === b.quote && a.note === b.note && a.page === b.page;
  const copies = [...cmd.copies].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const tos = new Map<string, (typeof live)[number]>();
  for (const c of copies) {
    if (!isHighlightId(c.to)) return err(copiesInvalid('to is not a lowercase uuid'));
    const src = bySource.get(c.from)!;
    const prev = tos.get(c.to);
    if (prev && !sameContent(prev, src)) return err(copiesInvalid('to is repeated for different entries'));
    tos.set(c.to, src);
  }

  const moved = moveAssignments(
    'tagMoves', cmd.tagMoves, snapshot!.duplicateAssignments.filter((a) => a.deletedAt === null), snapshot!.survivorAssignments,
    (src) => ({ itemId: s.id, tagId: src.tagId }), now,
  );
  if (!moved.ok) return moved;

  const changes: Change[] = [{ tbl: 'items', rowId: s.id, fields: articleRow(s, s.readOn ?? d.readOn) }];
  const inserted = new Set<string>();
  for (const c of copies) {
    if (onSurvivor.has(c.to) || inserted.has(c.to)) continue;
    inserted.add(c.to);
    const h = bySource.get(c.from)!;
    changes.push({
      tbl: 'highlights',
      rowId: c.to,
      fields: { item_id: s.id, quote: h.quote, note: h.note, page: h.page, created_at: h.createdAt, local_date: h.localDate },
    });
  }
  for (const c of copies) changes.push({ tbl: 'highlights', rowId: c.from, fields: { deleted_at: now } });
  changes.push(...moved.value);
  changes.push({ tbl: 'items', rowId: d.id, fields: { deleted_at: now, merged_into: s.id } });
  return decided(changes);
}

type BookCommand = Exclude<
  Command,
  { kind: 'MergeBooks' | 'DismissDuplicate' | 'AddHighlight' | 'EditHighlightNote' | 'RemoveHighlight' | 'RestoreHighlight'
      | 'TagArticle' | 'UntagArticle' | 'RenameTag' | 'DeleteTag' | 'ReconcileSavedArticle' }
>;

/** The single write path (constitution IV): pure, deterministic, no I/O. */
export function decide(
  snapshot: BookSnapshot | BooksSnapshot | HighlightSnapshot | TagSnapshot | ReconcileSnapshot | null,
  cmd: Command,
  now: Instant,
): Decided {
  const hs = snapshot !== null && 'highlight' in snapshot ? snapshot : null;
  const ts = snapshot !== null && 'assignments' in snapshot ? snapshot : null;
  const rs = snapshot !== null && 'duplicateHighlights' in snapshot ? snapshot : null;
  switch (cmd.kind) {
    case 'AddHighlight':
      return addHighlight(hs, cmd, now);
    case 'EditHighlightNote':
      return editHighlightNote(hs, cmd);
    case 'RemoveHighlight':
      return setHighlightRemoved(hs, now);
    case 'RestoreHighlight':
      return setHighlightRemoved(hs, null);
    case 'TagArticle':
      return tagArticle(ts, cmd, now);
    case 'UntagArticle':
      return untagArticle(ts, cmd, now);
    case 'RenameTag':
      return renameTag(ts, cmd, now);
    case 'DeleteTag':
      return deleteTag(ts, cmd, now);
    case 'ReconcileSavedArticle':
      return reconcileSaved(rs, cmd, now);
  }
  if (hs !== null || ts !== null || rs !== null) return err({ kind: 'NotFound' });
  const bs = snapshot && 'books' in snapshot ? snapshot : null;
  if (cmd.kind === 'MergeBooks') return mergeBooks(bs, cmd, now);
  if (cmd.kind === 'DismissDuplicate') return dismissDuplicate(bs, cmd, now);
  return decideOne(snapshot && 'item' in snapshot && 'events' in snapshot ? snapshot : null, cmd, now);
}

function decideOne(snapshot: BookSnapshot | null, cmd: Exclude<BookCommand, { kind: 'MergeBooks' | 'DismissDuplicate' }>, now: Instant): Decided {
  switch (cmd.kind) {
    case 'AddBook':
      return addBook(snapshot, cmd, now);
    case 'LogEvent':
      return logEvent(snapshot, cmd, now);
    case 'EditBook':
      return editBook(snapshot, cmd);
    case 'FillDetails':
      return fillDetails(snapshot, cmd);
    case 'RemoveBook':
      return removeBook(snapshot, now);
    case 'RemoveEvent':
      return removeEvent(snapshot, cmd, now);
    case 'AddArticle':
      return addArticle(snapshot, cmd, now);
    case 'EditArticle':
      return editArticle(snapshot, cmd);
    case 'RemoveArticle':
      return removeArticle(snapshot, now);
    case 'MarkArticleRead':
      return markArticleRead(snapshot, cmd);
    case 'MarkArticleUnread':
      return markArticleUnread(snapshot);
  }
}
