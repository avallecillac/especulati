import { describe, expect, it } from 'vitest';
import { decide, type Command, type Page } from '../src/index.ts';
import { book, event, itemId, NOW, snap } from './fixtures.ts';

const edit = (p: Omit<Extract<Command, { kind: 'EditBook' }>, 'kind' | 'itemId'>): Command => ({ kind: 'EditBook', itemId: itemId(1), ...p });
const withAuthor = snap(book({ author: 'Herbert' as never, genre: 'SF' as never }));

describe('decide EditBook', () => {
  it('emits only the fields that changed', () => {
    expect(decide(withAuthor, edit({ title: 'Dune Messiah', author: 'Herbert', totalPages: 300, genre: 'SF' }), NOW)).toEqual({
      ok: true,
      value: { offerFinish: false, changes: [{ tbl: 'items', rowId: itemId(1), fields: { title: 'Dune Messiah' } }] },
    });
  });

  it('an unchanged value emits nothing', () =>
    expect(decide(withAuthor, edit({ title: ' Dune ', author: 'Herbert' }), NOW)).toEqual({ ok: true, value: { offerFinish: false, changes: [] } }));

  it('clearing optional fields sets them to null', () => {
    const r = decide(withAuthor, edit({ author: '', totalPages: null, genre: '  ' }), NOW);
    expect(r.ok && r.value.changes[0]!.fields).toEqual({ author: null, total_pages: null, genre: null });
  });

  it('rejects a blank title and bad page counts', () => {
    expect(decide(withAuthor, edit({ title: '  ' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
    expect(decide(withAuthor, edit({ totalPages: 0 }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidPageCount' } });
  });

  it('PagesBelowLogged when total pages < the highest logged page', () => {
    const logged = snap(book(), [event({ type: 'progress', page: 250 as Page })]);
    expect(decide(logged, edit({ totalPages: 200 }), NOW)).toEqual({ ok: false, error: { kind: 'PagesBelowLogged', maxLogged: 250 } });
    expect(decide(logged, edit({ totalPages: 250 }), NOW).ok).toBe(true);
  });

  it('NotFound for unknown or removed books', () => {
    expect(decide(null, edit({ title: 'X' }), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
    expect(decide(snap(book({ deletedAt: NOW })), edit({ title: 'X' }), NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } });
  });
});

describe('decide RemoveBook', () => {
  it('sets deleted_at = now', () =>
    expect(decide(snap(book()), { kind: 'RemoveBook', itemId: itemId(1) }, NOW)).toEqual({
      ok: true,
      value: { offerFinish: false, changes: [{ tbl: 'items', rowId: itemId(1), fields: { deleted_at: NOW } }] },
    }));

  it('removing an already-removed book emits zero changes', () =>
    expect(decide(snap(book({ deletedAt: NOW })), { kind: 'RemoveBook', itemId: itemId(1) }, NOW)).toEqual({ ok: true, value: { offerFinish: false, changes: [] } }));

  it('NotFound for an unknown id', () =>
    expect(decide(null, { kind: 'RemoveBook', itemId: itemId(1) }, NOW)).toEqual({ ok: false, error: { kind: 'NotFound' } }));
});
