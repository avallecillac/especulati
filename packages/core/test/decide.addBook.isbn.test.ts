import { describe, expect, it } from 'vitest';
import { decide, type Command } from '../src/index.ts';
import { book, itemId, NOW, snap } from './fixtures.ts';

const add = (p: Partial<Extract<Command, { kind: 'AddBook' }>> = {}): Command => ({
  kind: 'AddBook', itemId: itemId(1), title: 'Dune', startNow: false, localDate: '2026-09-27', ...p,
});
const edit = (p: Partial<Extract<Command, { kind: 'EditBook' }>> = {}): Command => ({ kind: 'EditBook', itemId: itemId(1), ...p });
const fieldsOf = (r: ReturnType<typeof decide>) => (r.ok ? r.value.changes[0]?.fields : undefined);

describe('decide AddBook (002)', () => {
  it('always writes metadata_status, default ok', () =>
    expect(fieldsOf(decide(null, add(), NOW))).toEqual({ type: 'book', title: 'Dune', metadata_status: 'ok', created_at: NOW }));

  it('stores the normalized isbn', () =>
    expect(fieldsOf(decide(null, add({ isbn: '0-441-47812-3' }), NOW))).toMatchObject({ isbn: '9780441478125', title: 'Dune' }));

  it('blank title + isbn → ISBN placeholder title', () => {
    expect(fieldsOf(decide(null, add({ title: '  ', isbn: '0-441-47812-3' }), NOW))).toMatchObject({ title: 'ISBN 9780441478125', isbn: '9780441478125' });
  });

  it('blank title without isbn is TitleRequired', () => {
    expect(decide(null, add({ title: '' }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
    expect(decide(null, add({ title: '', isbn: null }), NOW)).toEqual({ ok: false, error: { kind: 'TitleRequired' } });
  });

  it('maps detailsStatus to metadata_status', () => {
    expect(fieldsOf(decide(null, add({ detailsStatus: 'pending' }), NOW))).toMatchObject({ metadata_status: 'pending' });
    expect(fieldsOf(decide(null, add({ detailsStatus: 'notFound' }), NOW))).toMatchObject({ metadata_status: 'failed' });
    expect(fieldsOf(decide(null, add({ detailsStatus: 'complete' }), NOW))).toMatchObject({ metadata_status: 'ok' });
  });

  it('stores an https coverUrl, rejects http', () => {
    expect(fieldsOf(decide(null, add({ coverUrl: 'https://c.example/a.jpg' }), NOW))).toMatchObject({ cover_url: 'https://c.example/a.jpg' });
    expect(decide(null, add({ coverUrl: 'http://x' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'coverUrl' } });
  });

  it('invalid isbn → InvalidIsbn', () =>
    expect(decide(null, add({ isbn: '9780441172718' }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidIsbn' } }));
});

describe('decide EditBook (002)', () => {
  const withIsbn = snap(book({ isbn: '9780441478125' as never }));

  it('sets an isbn (normalized)', () =>
    expect(decide(snap(book()), edit({ isbn: '0-441-47812-3' }), NOW)).toEqual({
      ok: true, value: { offerFinish: false, changes: [{ tbl: 'items', rowId: itemId(1), fields: { isbn: '9780441478125' } }] },
    }));

  it('changes an isbn, and emits nothing when unchanged', () => {
    expect(fieldsOf(decide(withIsbn, edit({ isbn: '978-0-441-17271-9' }), NOW))).toEqual({ isbn: '9780441172719' });
    expect(decide(withIsbn, edit({ isbn: '0441478123' }), NOW)).toMatchObject({ ok: true, value: { changes: [] } });
  });

  it('clears an isbn with null', () => {
    expect(fieldsOf(decide(withIsbn, edit({ isbn: null }), NOW))).toEqual({ isbn: null });
    expect(decide(snap(book()), edit({ isbn: null }), NOW)).toMatchObject({ ok: true, value: { changes: [] } });
  });

  it('invalid isbn → InvalidIsbn', () =>
    expect(decide(withIsbn, edit({ isbn: '123' }), NOW)).toEqual({ ok: false, error: { kind: 'InvalidIsbn' } }));

  it('coverUrl set/clear, and rejects http', () => {
    expect(fieldsOf(decide(snap(book()), edit({ coverUrl: 'https://c.example/a.jpg' }), NOW))).toEqual({ cover_url: 'https://c.example/a.jpg' });
    expect(decide(snap(book()), edit({ coverUrl: 'http://x' }), NOW)).toMatchObject({ ok: false, error: { kind: 'InvalidInput', field: 'coverUrl' } });
    expect(fieldsOf(decide(snap(book({ coverUrl: 'https://c.example/a.jpg' as never })), edit({ coverUrl: null }), NOW))).toEqual({ cover_url: null });
  });

  it('detailsStatus complete on a pending book → metadata_status ok; unchanged → nothing', () => {
    expect(fieldsOf(decide(snap(book({ detailsStatus: 'pending' })), edit({ detailsStatus: 'complete' }), NOW))).toEqual({ metadata_status: 'ok' });
    expect(fieldsOf(decide(snap(book({ detailsStatus: 'pending' })), edit({ detailsStatus: 'notFound' }), NOW))).toEqual({ metadata_status: 'failed' });
    expect(decide(snap(book()), edit({ detailsStatus: 'complete' }), NOW)).toMatchObject({ ok: true, value: { changes: [] } });
  });
});
