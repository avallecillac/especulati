import type { Database } from '@sqlite.org/sqlite-wasm';
import { tagKey } from '@especulati/lector-core';
import { TAG_ID_LABEL } from './frozen.ts';
import { text } from './snapshot.ts';

/** One live tag on one article (008). */
export interface ItemTagView {
  itemTagId: string;
  tagId: string;
  name: string;
  nameKey: string;
}

/** Live tags sharing one `name_key`, shown as one tag (research R3: a rare concurrent duplicate groups). */
export interface TagSummary {
  nameKey: string;
  /** The name of the earliest-created tag of the group. */
  name: string;
  /** Every live tag id of the group, sorted. */
  tagIds: string[];
  /** Articles (live, saved or read) carrying a live assignment of any tag in the group. */
  count: number;
}

/**
 * The live tags of a live article, by name key. A concurrent duplicate (two tag ids with one key on the
 * same article) shows once, with the earliest assignment's id.
 */
export function tagsFor(db: Database, itemId: string): ItemTagView[] {
  const rows = db.selectArrays(
    `SELECT it.id, t.id, t.name, t.name_key FROM item_tags it
     JOIN tags t ON t.id = it.tag_id
     JOIN items i ON i.id = it.item_id
     WHERE it.item_id = ? AND it.deleted_at IS NULL AND t.deleted_at IS NULL AND i.deleted_at IS NULL
     ORDER BY t.name_key, it.created_at, it.id`,
    [itemId],
  );
  const seen = new Set<string>();
  const out: ItemTagView[] = [];
  for (const r of rows) {
    const nameKey = text(r[3], 'name_key');
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);
    out.push({ itemTagId: text(r[0], 'id'), tagId: text(r[1], 'tag_id'), name: text(r[2], 'name'), nameKey });
  }
  return out;
}

/** Every live tag grouped by name key, with its article count; sorted by name key. */
export function allTags(db: Database): TagSummary[] {
  const tags = db.selectArrays(`SELECT id, name, name_key FROM tags WHERE deleted_at IS NULL ORDER BY name_key, created_at, id`);
  const links = db.selectArrays(
    `SELECT it.tag_id, it.item_id FROM item_tags it
     JOIN items i ON i.id = it.item_id
     WHERE it.deleted_at IS NULL AND i.deleted_at IS NULL AND i.type = 'article'
       AND it.tag_id IN (SELECT id FROM tags WHERE deleted_at IS NULL)`,
  );
  const keyOf = new Map<string, string>();
  const groups = new Map<string, { name: string; tagIds: string[]; items: Set<string> }>();
  for (const r of tags) {
    const id = text(r[0], 'id');
    const key = text(r[2], 'name_key');
    keyOf.set(id, key);
    const g = groups.get(key);
    if (g) g.tagIds.push(id);
    else groups.set(key, { name: text(r[1], 'name'), tagIds: [id], items: new Set() });
  }
  for (const l of links) groups.get(keyOf.get(text(l[0], 'tag_id'))!)?.items.add(text(l[1], 'item_id'));
  return [...groups.entries()]
    .map(([nameKey, g]) => ({ nameKey, name: g.name, tagIds: g.tagIds.sort(), count: g.items.size }))
    .sort((a, b) => (a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0));
}

/** Tags whose key starts with `prefix` (normalised like a name), most used first, then by key. */
export function tagSuggestions(db: Database, prefix: string, limit = 8): TagSummary[] {
  const key = tagKey(prefix) ?? '';
  return allTags(db)
    .filter((t) => t.nameKey.startsWith(key))
    .sort((a, b) => b.count - a.count || (a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0))
    .slice(0, Math.max(0, limit));
}

/**
 * The tag id to use for `name` (research R3 steps 1-4), or null when the name is empty after normalising.
 *
 * Core is pure and the DB layer has no hash, so the shell injects `hash` (its `uuidFromHash`; WebCrypto is
 * async). This keeps the resolution a single place that reads the DB, while ids stay computed in the shell.
 *   1. a live tag with the same name key: use it (the earliest created, then smallest id, if a concurrent duplicate exists);
 *   2. otherwise the derived id `hash("readerlog-tag-v1|" + key)` if no row has it;
 *   3. if that row is a tombstone: use it (TagArticle restores it under the new name);
 *   4. otherwise (a live tag with another key holds it, after a rename): the first `hash(... + "|" + n)`, n = 1, 2, ...,
 *      that is free or a tombstone.
 */
export async function resolveTagId(db: Database, name: string, hash: (label: string) => Promise<string>): Promise<string | null> {
  const key = tagKey(name);
  if (key === null) return null;
  const live = db.selectValue(`SELECT id FROM tags WHERE name_key = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`, [key]);
  if (typeof live === 'string') return live;
  const usable = (id: string): boolean => {
    const row = db.selectArrays('SELECT deleted_at FROM tags WHERE id = ?', [id])[0];
    return row === undefined || row[0] !== null;
  };
  const label = `${TAG_ID_LABEL}|${key}`;
  const derived = await hash(label);
  if (usable(derived)) return derived;
  for (let n = 1; ; n++) {
    const id = await hash(`${label}|${n}`);
    if (usable(id)) return id;
  }
}
