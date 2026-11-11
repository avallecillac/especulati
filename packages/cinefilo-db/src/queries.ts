import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  filterByVerdict,
  type Kind, type LocalDate, type MemberRow, type Status, type TitleRow, type Verdict, type VerdictFilter,
} from '@especulati/cinefilo-core';
import { readMeta } from '@especulati/db-kit';
import { rowToMember, rowToRating, rowToTitle, text, textOrNull } from './snapshot.ts';

/** The three lists (cinefilo-watchlist): Watched also holds dropped series. */
export type ListTab = 'later' | 'watching' | 'watched';

const TAB_STATUSES: Readonly<Record<ListTab, readonly Status[]>> = { later: ['later'], watching: ['watching'], watched: ['watched', 'dropped'] };
/** Newest added first; Watched is most recently watched first. Id breaks ties so every device orders alike. */
const TAB_ORDER: Readonly<Record<ListTab, string>> = {
  later: 'created_at DESC, id',
  watching: 'created_at DESC, id',
  watched: 'watched_on DESC, created_at DESC, id',
};

export interface ListItem {
  readonly id: string;
  readonly kind: Kind;
  readonly title: string;
  readonly year: number | null;
  readonly posterUrl: string | null;
  readonly status: Status;
  readonly watchedOn: LocalDate | null;
  readonly currentSeason: number | null;
  readonly seasonCount: number | null;
  /** This device's member's verdict (null = none). */
  readonly mine: Verdict | null;
  /** The partner's verdict (null = none). */
  readonly partner: Verdict | null;
}

export interface MemberView {
  readonly id: string;
  readonly name: string;
  /** The member this device acts as. */
  readonly me: boolean;
}

export interface RatingView {
  readonly memberId: string;
  readonly name: string;
  readonly verdict: Verdict | null;
  readonly review: string | null;
  /** True for the device's member: the only column the UI lets the user edit. */
  readonly mine: boolean;
}

export interface TitleDetail {
  readonly title: TitleRow;
  /** One entry per live member: this device's member first, then the others by creation. */
  readonly ratings: readonly RatingView[];
}

const LIVE = 'deleted_at IS NULL AND merged_into IS NULL';

export function currentMemberId(db: Database): string | null {
  return readMeta(db, 'member_id');
}

/** Live members, the device's own first, then by creation. */
export function members(db: Database): MemberView[] {
  const me = currentMemberId(db);
  const rows: MemberRow[] = db.selectObjects('SELECT * FROM members WHERE deleted_at IS NULL ORDER BY created_at, id').map(rowToMember);
  const own = rows.filter((m) => m.id === me);
  return [...own, ...rows.filter((m) => m.id !== me)].map((m) => ({ id: m.id, name: m.name, me: m.id === me }));
}

/** The partner: the earliest-created live member that is not this device's. */
const partnerId = (db: Database): string | null => members(db).find((m) => !m.me)?.id ?? null;

/** Live titles of a tab with both verdicts; `filter` applies the verdict-agreement chips. */
export function list(db: Database, tab: ListTab, filter?: VerdictFilter): ListItem[] {
  const statuses = TAB_STATUSES[tab];
  const rows = db
    .selectObjects(`SELECT * FROM titles WHERE ${LIVE} AND status IN (${statuses.map(() => '?').join(', ')}) ORDER BY ${TAB_ORDER[tab]}`, [...statuses])
    .map(rowToTitle);
  const me = currentMemberId(db);
  const partner = partnerId(db);
  const verdicts = new Map<string, Verdict>();
  for (const r of db.selectObjects(
    `SELECT r.title_id, r.member_id, r.verdict FROM ratings r JOIN titles t ON t.id = r.title_id
      WHERE r.deleted_at IS NULL AND r.verdict IS NOT NULL AND t.deleted_at IS NULL AND t.merged_into IS NULL
        AND t.status IN (${statuses.map(() => '?').join(', ')})`,
    [...statuses],
  )) {
    verdicts.set(`${text(r['title_id'], 'title_id')}|${text(r['member_id'], 'member_id')}`, text(r['verdict'], 'verdict') as Verdict);
  }
  const items: ListItem[] = rows.map((t) => ({
    id: t.id, kind: t.kind, title: t.title, year: t.year, posterUrl: t.posterUrl, status: t.status, watchedOn: t.watchedOn,
    currentSeason: t.currentSeason, seasonCount: t.seasonCount,
    mine: me ? (verdicts.get(`${t.id}|${me}`) ?? null) : null,
    partner: partner ? (verdicts.get(`${t.id}|${partner}`) ?? null) : null,
  }));
  return filter ? filterByVerdict(filter, items, (i) => [i.mine, i.partner]) : items;
}

/** A live, unmerged title with the rating of every live member; null when absent, removed or merged away. */
export function titleDetail(db: Database, id: string): TitleDetail | null {
  const r = db.selectObject(`SELECT * FROM titles WHERE id = ? AND ${LIVE}`, [id]);
  if (!r) return null;
  const title = rowToTitle(r);
  const byMember = new Map(
    db.selectObjects('SELECT * FROM ratings WHERE title_id = ? AND deleted_at IS NULL', [id]).map(rowToRating).map((x) => [x.memberId as string, x]),
  );
  const ratings = members(db).map((m) => {
    const x = byMember.get(m.id);
    return { memberId: m.id, name: m.name, verdict: x?.verdict ?? null, review: x?.review ?? null, mine: m.me };
  });
  return { title, ratings };
}

/** A title linked to TMDB that has neither poster nor genres yet (an imported one): the shell fills it in the background. */
export interface NeedsDetails {
  readonly id: string;
  readonly kind: Kind;
  readonly tmdbId: number;
}

export function needsDetails(db: Database, limit: number): NeedsDetails[] {
  return db
    .selectObjects(
      `SELECT id, kind, tmdb_id FROM titles WHERE tmdb_id IS NOT NULL AND poster_url IS NULL AND genres IS NULL AND ${LIVE} ORDER BY created_at DESC, id LIMIT ?`,
      [limit],
    )
    .map((r) => ({ id: text(r['id'], 'id'), kind: text(r['kind'], 'kind') as Kind, tmdbId: Number(r['tmdb_id']) }));
}

/** The live title with this TMDB id and kind, if any (the UI opens it instead of adding a duplicate). */
export function findByTmdb(db: Database, tmdbId: number, kind: Kind): string | null {
  return textOrNull(db.selectValue(`SELECT id FROM titles WHERE tmdb_id = ? AND kind = ? AND ${LIVE} ORDER BY created_at, id LIMIT 1`, [tmdbId, kind]), 'id');
}
