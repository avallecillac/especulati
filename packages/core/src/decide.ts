import { err, ok, type Result } from './result.ts';
import type { BookSnapshot, Change, Command, Decision, FieldValue, Rejection } from './commands.ts';
import { deriveStatus, maxLoggedPage, type BookStatus, type EventType } from './book.ts';
import {
  parseAuthor, parseEventId, parseGenre, parseItemId, parseLocalDate, parsePage, parsePageCount, parseTitle,
  type Instant, type ParseError,
} from './types.ts';

type Decided = Result<Decision, Rejection>;

const invalid = (e: ParseError): Rejection => ({ kind: 'InvalidInput', field: e.field, reason: e.reason });
const decided = (changes: Change[], offerFinish = false): Decided => ok({ changes, offerFinish });

/** Parse, or short-circuit with the mapped rejection. */
function need<T>(r: Result<T, ParseError>, onError: (e: ParseError) => Rejection = invalid): Result<T, Rejection> {
  return r.ok ? r : err(onError(r.error));
}

const titleRejection = (e: ParseError): Rejection => (e.reason === 'required' ? { kind: 'TitleRequired' } : invalid(e));
const pageCountRejection = (): Rejection => ({ kind: 'InvalidPageCount' });

function addBook(snapshot: BookSnapshot | null, cmd: Extract<Command, { kind: 'AddBook' }>, now: Instant): Decided {
  const id = need(parseItemId(cmd.itemId));
  if (!id.ok) return id;
  if (snapshot) return err({ kind: 'AlreadyExists' });
  const title = need(parseTitle(cmd.title), titleRejection);
  if (!title.ok) return title;
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

/** The single write path (constitution IV): pure, deterministic, no I/O. */
export function decide(snapshot: BookSnapshot | null, cmd: Command, now: Instant): Decided {
  switch (cmd.kind) {
    case 'AddBook':
      return addBook(snapshot, cmd, now);
    case 'LogEvent':
      return logEvent(snapshot, cmd, now);
    case 'EditBook':
      return editBook(snapshot, cmd);
    case 'RemoveBook':
      return removeBook(snapshot, now);
    case 'RemoveEvent':
      return removeEvent(snapshot, cmd, now);
  }
}
