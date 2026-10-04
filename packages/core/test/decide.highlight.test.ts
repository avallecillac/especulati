import { describe, expect, it } from 'vitest';
import {
  decide, type Change, type Command, type Highlight, type HighlightId, type HighlightSnapshot, type ItemId, type Instant, type LocalDate,
} from '../src/index.ts';
import { NOW, uuid } from './fixtures.ts';

const HID = uuid(70);
const ITEM = uuid(50);
const LATER = '2026-10-01T09:00:00.000Z' as Instant;

const item = (p: Partial<NonNullable<HighlightSnapshot['item']>> = {}): NonNullable<HighlightSnapshot['item']> => ({
  id: ITEM as ItemId,
  type: 'article',
  deletedAt: null,
  ...p,
});

const add = (p: Partial<Extract<Command, { kind: 'AddHighlight' }>> = {}): Command => ({
  kind: 'AddHighlight',
  highlightId: HID,
  itemId: ITEM,
  quote: '  First   passage ',
  note: ' my thought ',
  localDate: '2026-09-27',
  ...p,
});

const addSnap = (i: HighlightSnapshot['item'] = item()): HighlightSnapshot => ({ item: i, highlight: null });

const changesOf = (r: ReturnType<typeof decide>): readonly Change[] => {
  if (!r.ok) throw new Error(`rejected: ${r.error.kind}`);
  return r.value.changes;
};

/** Apply highlight changes in memory, as the DB would. */
function apply(h: Highlight | null, changes: readonly Change[]): Highlight | null {
  let cur = h;
  for (const c of changes) {
    const f = c.fields;
    cur = {
      ...(cur ?? {
        id: c.rowId as HighlightId, itemId: f['item_id'] as ItemId, quote: null, note: null, page: null,
        createdAt: f['created_at'] as Instant, localDate: f['local_date'] as LocalDate, deletedAt: null,
      }),
      ...('quote' in f ? { quote: f['quote'] as string | null } : {}),
      ...('note' in f ? { note: f['note'] as string | null } : {}),
      ...('page' in f ? { page: f['page'] as number | null } : {}),
      ...('deleted_at' in f ? { deletedAt: f['deleted_at'] as Instant | null } : {}),
    };
  }
  return cur;
}

const created = (p: Partial<Extract<Command, { kind: 'AddHighlight' }>> = {}): Highlight => {
  const h = apply(null, changesOf(decide(addSnap(), add(p), NOW)));
  if (!h) throw new Error('none');
  return h;
};

const hsnap = (h: Highlight | null): HighlightSnapshot => ({ item: item(), highlight: h });

describe('decide AddHighlight', () => {
  it('inserts one highlights row with the normalised quote and note', () => {
    expect(decide(addSnap(), add(), NOW)).toEqual({
      ok: true,
      value: {
        offerFinish: false,
        changes: [
          {
            tbl: 'highlights',
            rowId: HID,
            fields: { item_id: ITEM, quote: 'First passage', note: 'my thought', page: null, created_at: NOW, local_date: '2026-09-27' },
          },
        ],
      },
    });
  });

  it('accepts a note alone and a quote alone', () => {
    expect(changesOf(decide(addSnap(), add({ quote: null }), NOW))[0]!.fields).toMatchObject({ quote: null, note: 'my thought' });
    expect(changesOf(decide(addSnap(), add({ note: null }), NOW))[0]!.fields).toMatchObject({ quote: 'First passage', note: null });
  });

  it('a missing or removed item is NotFound', () => {
    expect(decide(addSnap(null), add(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(null, add(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(addSnap(item({ deletedAt: LATER })), add(), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });

  it('both fields empty is HighlightEmpty', () => {
    expect(decide(addSnap(), add({ quote: ' \n ', note: '' }), NOW)).toEqual({ ok: false, error: { kind: 'HighlightEmpty' } });
    expect(decide(addSnap(), add({ quote: null, note: null }), NOW)).toEqual({ ok: false, error: { kind: 'HighlightEmpty' } });
  });

  it('over 5,000 characters is TooLong, naming the field', () => {
    expect(decide(addSnap(), add({ quote: 'a'.repeat(5001) }), NOW)).toEqual({ ok: false, error: { kind: 'TooLong', field: 'quote', max: 5000 } });
    expect(decide(addSnap(), add({ note: 'a'.repeat(5001) }), NOW)).toEqual({ ok: false, error: { kind: 'TooLong', field: 'note', max: 5000 } });
    expect(decide(addSnap(), add({ quote: 'a'.repeat(5000) }), NOW).ok).toBe(true);
  });

  it('a malformed id or localDate is InvalidInput', () => {
    const bad = (p: Partial<Extract<Command, { kind: 'AddHighlight' }>>) => {
      const r = decide(addSnap(), add(p), NOW);
      return r.ok ? 'ok' : r.error.kind;
    };
    expect(bad({ highlightId: 'nope' })).toBe('InvalidInput');
    expect(bad({ itemId: 'nope' })).toBe('InvalidInput');
    expect(bad({ localDate: '2026-13-01' })).toBe('InvalidInput');
    expect(bad({ localDate: '27/09/2026' })).toBe('InvalidInput');
  });

  it('page on an article is InvalidInput { field: page }', () => {
    expect(decide(addSnap(), add({ page: 12 }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'page' } });
  });

  it('page on a book is accepted; it must be a positive integer', () => {
    const book = item({ type: 'book' });
    expect(changesOf(decide(addSnap(book), add({ page: 12 }), NOW))[0]!.fields).toMatchObject({ page: 12 });
    expect(decide(addSnap(book), add({ page: 0 }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'page' } });
    expect(decide(addSnap(book), add({ page: 1.5 }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'page' } });
  });

  it('HL-1: the same id twice is AlreadyExists', () => {
    const h = created();
    expect(decide({ item: item(), highlight: h }, add(), NOW)).toEqual({ ok: false, error: { kind: 'AlreadyExists' } });
  });

  it('HL-2: the stored quote equals normalizeQuote(input)', () => {
    expect(created({ quote: 'a   b\r\n\r\n\r\n\r\nc' }).quote).toBe('a b\n\nc');
  });
});

describe('decide EditHighlightNote', () => {
  const edit = (note: string): Command => ({ kind: 'EditHighlightNote', highlightId: HID, note });

  it('changes only the note', () => {
    expect(decide(hsnap(created()), edit('  new note '), LATER)).toEqual({
      ok: true,
      value: { offerFinish: false, changes: [{ tbl: 'highlights', rowId: HID, fields: { note: 'new note' } }] },
    });
  });

  it('an unchanged note gives no changes', () => {
    expect(changesOf(decide(hsnap(created()), edit('my thought'), LATER))).toEqual([]);
  });

  it('clearing the note keeps the quote', () => {
    expect(changesOf(decide(hsnap(created()), edit('  '), LATER))).toEqual([{ tbl: 'highlights', rowId: HID, fields: { note: null } }]);
  });

  it('clearing the note of a note-only highlight is HighlightEmpty', () => {
    expect(decide(hsnap(created({ quote: null })), edit(''), LATER)).toEqual({ ok: false, error: { kind: 'HighlightEmpty' } });
  });

  it('over 5,000 characters is TooLong', () => {
    expect(decide(hsnap(created()), edit('a'.repeat(5001)), LATER)).toEqual({ ok: false, error: { kind: 'TooLong', field: 'note', max: 5000 } });
  });

  it('missing or removed is NotFound', () => {
    expect(decide(hsnap(null), edit('x'), LATER)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(hsnap({ ...created(), deletedAt: LATER }), edit('x'), LATER)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('decide RemoveHighlight and RestoreHighlight', () => {
  const remove: Command = { kind: 'RemoveHighlight', highlightId: HID };
  const restore: Command = { kind: 'RestoreHighlight', highlightId: HID };

  it('Remove sets deleted_at to now', () => {
    expect(changesOf(decide(hsnap(created()), remove, LATER))).toEqual([{ tbl: 'highlights', rowId: HID, fields: { deleted_at: LATER } }]);
  });

  it('Remove is idempotent', () => {
    expect(changesOf(decide(hsnap({ ...created(), deletedAt: LATER }), remove, NOW))).toEqual([]);
  });

  it('Restore clears deleted_at', () => {
    expect(changesOf(decide(hsnap({ ...created(), deletedAt: LATER }), restore, NOW))).toEqual([
      { tbl: 'highlights', rowId: HID, fields: { deleted_at: null } },
    ]);
  });

  it('Restore is idempotent', () => {
    expect(changesOf(decide(hsnap(created()), restore, NOW))).toEqual([]);
  });

  it('a missing highlight is NotFound', () => {
    expect(decide(hsnap(null), remove, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(hsnap(null), restore, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(null, remove, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });

  it('HL-4: Remove then Restore gives the original row', () => {
    const original = created();
    const removed = apply(original, changesOf(decide(hsnap(original), remove, LATER)));
    expect(removed!.deletedAt).toBe(LATER);
    const restored = apply(removed, changesOf(decide(hsnap(removed), restore, LATER)));
    expect(restored).toEqual(original);
  });
});
