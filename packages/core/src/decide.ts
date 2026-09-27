import { err, ok, type Result } from './result.ts';
import type { BookSnapshot, Change, Command, Decision, FieldValue, Rejection } from './commands.ts';
import {
  parseAuthor, parseEventId, parseGenre, parseItemId, parseLocalDate, parsePageCount, parseTitle,
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

/** The single write path (constitution IV): pure, deterministic, no I/O. */
export function decide(snapshot: BookSnapshot | null, cmd: Command, now: Instant): Decided {
  switch (cmd.kind) {
    case 'AddBook':
      return addBook(snapshot, cmd, now);
    default:
      return err({ kind: 'InvalidInput', field: 'command', reason: `${cmd.kind} not implemented` });
  }
}
