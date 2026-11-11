import type { Database } from '@sqlite.org/sqlite-wasm';
import { searchKey, tagKey } from '@especulati/lector-core';
import { text, textOrNull } from './snapshot.ts';

/** A matched highlight quote or note, original text (research R5). */
export interface SearchPassage {
  kind: 'quote' | 'note';
  text: string;
}

export interface SearchHit {
  itemId: string;
  title: string;
  author: string | null;
  domain: string;
  status: 'read' | 'saved';
  /** The read date; null for a saved article. */
  readOn: string | null;
  createdAt: string;
  /** The first highlight or note that supplied a match the article's own fields did not; else null. */
  passage: SearchPassage | null;
}

export interface SearchOptions {
  /** Tag chips as name keys (`tagKey` of the name): the article must carry all of them. */
  tagKeys?: readonly string[];
  limit?: number;
}

export const SEARCH_LIMIT = 200;

interface Entry {
  hit: Omit<SearchHit, 'passage'>;
  /** Title, author, domain and tag names, folded and joined by newlines: a term never spans two of them. */
  meta: string;
  tagKeys: Set<string>;
  passages: { kind: 'quote' | 'note'; text: string; folded: string }[];
  /** All passages folded and joined by newlines. */
  passText: string;
}

/**
 * In-memory search index (008 research R5): one entry per live article, built lazily on the first query
 * and rebuilt after any change. It is keyed to `MAX(seq)` of `change_log`, which every local and remote
 * write advances, so it can never serve stale data even when something other than `invalidate()` changed it.
 * Text is held in memory only, never persisted, and never logged.
 */
export class SearchIndex {
  #entries: Entry[] | null = null;
  #stamp = -1;

  invalidate(): void {
    this.#entries = null;
  }

  #fresh(db: Database): Entry[] {
    const stamp = Number(db.selectValue('SELECT COALESCE(MAX(seq), 0) FROM change_log'));
    if (this.#entries === null || stamp !== this.#stamp) {
      this.#entries = build(db);
      this.#stamp = stamp;
    }
    return this.#entries;
  }

  search(db: Database, query: string, opts: SearchOptions = {}): SearchHit[] {
    const terms = searchKey(query).split(/\s+/).filter((t) => t !== '');
    const wanted = (opts.tagKeys ?? []).map((k) => tagKey(k)).filter((k): k is string => k !== null);
    if (terms.length === 0 && wanted.length === 0) return [];
    const limit = Math.max(1, Math.floor(opts.limit ?? SEARCH_LIMIT));
    const out: SearchHit[] = [];
    for (const e of this.#fresh(db)) {
      if (!wanted.every((k) => e.tagKeys.has(k))) continue;
      let ok = true;
      let viaPassage: string[] | null = null;
      for (const t of terms) {
        if (e.meta.includes(t)) continue;
        if (e.passText.includes(t)) (viaPassage ??= []).push(t);
        else { ok = false; break; }
      }
      if (!ok) continue;
      let passage: SearchPassage | null = null;
      if (viaPassage) {
        const p = e.passages.find((x) => viaPassage.some((t) => x.folded.includes(t)));
        if (p) passage = { kind: p.kind, text: p.text };
      }
      out.push({ ...e.hit, passage });
      if (out.length >= limit) break;
    }
    return out;
  }
}

function build(db: Database): Entry[] {
  const byId = new Map<string, Entry>();
  const items = db.selectArrays(
    `SELECT id, title, author, domain, read_on, created_at FROM items WHERE type = 'article' AND deleted_at IS NULL`,
  );
  for (const r of items) {
    const id = text(r[0], 'id');
    const title = text(r[1], 'title');
    const author = textOrNull(r[2], 'author');
    const domain = text(r[3], 'domain');
    const readOn = textOrNull(r[4], 'read_on');
    byId.set(id, {
      hit: { itemId: id, title, author, domain, status: readOn === null ? 'saved' : 'read', readOn, createdAt: text(r[5], 'created_at') },
      meta: [searchKey(title), searchKey(author ?? ''), searchKey(domain)].join('\n'),
      tagKeys: new Set(),
      passages: [],
      passText: '',
    });
  }
  for (const r of db.selectArrays(
    `SELECT it.item_id, t.name, t.name_key FROM item_tags it JOIN tags t ON t.id = it.tag_id
     WHERE it.deleted_at IS NULL AND t.deleted_at IS NULL`,
  )) {
    const e = byId.get(text(r[0], 'item_id'));
    if (!e) continue;
    e.meta += `\n${searchKey(text(r[1], 'name'))}`;
    e.tagKeys.add(text(r[2], 'name_key'));
  }
  for (const r of db.selectArrays(
    `SELECT h.item_id, h.quote, h.note FROM highlights h
     WHERE h.deleted_at IS NULL ORDER BY h.created_at, h.id`,
  )) {
    const e = byId.get(text(r[0], 'item_id'));
    if (!e) continue;
    for (const [kind, v] of [['quote', textOrNull(r[1], 'quote')], ['note', textOrNull(r[2], 'note')]] as const) {
      if (v === null) continue;
      e.passages.push({ kind, text: v, folded: searchKey(v) });
    }
  }
  const entries = [...byId.values()];
  for (const e of entries) e.passText = e.passages.length === 0 ? '' : e.passages.map((p) => p.folded).join('\n');
  // Newest first: the read date, else the saved date (day), then the saved instant, then id.
  const day = (e: Entry): string => e.hit.readOn ?? e.hit.createdAt.slice(0, 10);
  entries.sort((a, b) => (day(a) !== day(b) ? (day(a) < day(b) ? 1 : -1) : a.hit.createdAt !== b.hit.createdAt ? (a.hit.createdAt < b.hit.createdAt ? 1 : -1) : a.hit.itemId < b.hit.itemId ? -1 : 1));
  return entries;
}

