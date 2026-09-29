import { err, ok, type Result } from './result.ts';
import type { BooksSnapshot, BookSnapshot, Change, Command, Decision, FieldValue, Rejection } from './commands.ts';
import { deriveStatus, detailsStatusToDb, maxLoggedPage, type BookStatus, type EventType, type ReadingEvent } from './book.ts';
import {
  parseAuthor, parseCoverUrl, parseEventId, parseGenre, parseIsbn, parseItemId, parseLocalDate, parsePage, parsePageCount, parseTitle,
  type CoverUrl, type Instant, type Isbn13, type ParseError,
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
  if (cmd.page !== undefined && cmd.page !== null) {
    if (cmd.type !== 'progress') return err({ kind: 'PageNotAllowed' });
    const p = need(parsePage(cmd.page), () => ({ kind: 'InvalidPage' }));
    if (!p.ok) return p;
    if (item.totalPages !== null && p.value > item.totalPages) return err({ kind: 'PageBeyondEnd', totalPages: item.totalPages });
    page = p.value;
  }

  const from = deriveStatus(events);
  if (!ALLOWED_FROM[cmd.type].includes(from)) return err({ kind: 'InvalidTransition', from, type: cmd.type });

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
  if (!snapshot) return err({ kind: 'NotFound' });
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

/** The single write path (constitution IV): pure, deterministic, no I/O. */
export function decide(snapshot: BookSnapshot | BooksSnapshot | null, cmd: Command, now: Instant): Decided {
  if (cmd.kind === 'MergeBooks') return mergeBooks(snapshot && 'books' in snapshot ? snapshot : null, cmd, now);
  if (cmd.kind === 'DismissDuplicate') return dismissDuplicate(snapshot && 'books' in snapshot ? snapshot : null, cmd, now);
  return decideOne(snapshot && 'books' in snapshot ? null : snapshot, cmd, now);
}

function decideOne(snapshot: BookSnapshot | null, cmd: Exclude<Command, { kind: 'MergeBooks' | 'DismissDuplicate' }>, now: Instant): Decided {
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
  }
}
