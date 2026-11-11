import type { Database } from '@sqlite.org/sqlite-wasm';
import {
  filterByVerdict,
  type Instant, type Kind, type LocalDate, type MemberRow, type MemberStatus, type Status, type TitleRow, type Verdict, type VerdictFilter,
} from '@especulati/cinefilo-core';
import { readMeta } from '@especulati/db-kit';
import { intOrNull, rowToMember, rowToMemberStatus, rowToRating, rowToRecommendation, rowToTitle, text, textOrNull } from './snapshot.ts';

/** The three lists (cinefilo-watchlist): Watched also holds dropped series. */
export type ListTab = 'later' | 'watching' | 'watched';

/** Whose list: the shared one, this device's member's, or the partner's (read-only for the UI). */
export type ListScope = 'together' | 'me' | 'partner';

const TAB_STATUSES: Readonly<Record<ListTab, readonly Status[]>> = { later: ['later'], watching: ['watching'], watched: ['watched', 'dropped'] };
/** A personal list has no `dropped`. */
const MEMBER_TAB_STATUSES: Readonly<Record<ListTab, readonly MemberStatus[]>> = { later: ['later'], watching: ['watching'], watched: ['watched'] };
const MEMBER_TAB_ORDER: Readonly<Record<ListTab, string>> = {
  later: 'ms.updated_at DESC, t.id',
  watching: 'ms.updated_at DESC, t.id',
  watched: 'ms.watched_on DESC, ms.updated_at DESC, t.id',
};
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

/** A member's personal status of one title; `status` null = not on their list. */
export interface MemberStatusView {
  readonly memberId: string;
  readonly name: string;
  readonly mine: boolean;
  readonly status: MemberStatus | null;
  readonly watchedOn: LocalDate | null;
  readonly currentSeason: number | null;
}

/** `open` until the recipient answers or the recommender withdraws. */
export type RecommendationState = 'open' | 'accepted' | 'dismissed' | 'withdrawn';

export interface RecommendationView {
  readonly id: string;
  readonly fromMember: string;
  readonly fromName: string;
  readonly toMember: string;
  readonly toName: string;
  readonly fromMe: boolean;
  readonly toMe: boolean;
  readonly state: RecommendationState;
  readonly createdAt: Instant;
}

/** A recommendation waiting for this device's member (never shown to the recommender). */
export interface PendingRecommendation extends RecommendationView {
  readonly titleId: string;
  readonly kind: Kind;
  readonly title: string;
  readonly year: number | null;
  readonly posterUrl: string | null;
}

export interface TitleDetail {
  /** `title.status` is null for a title that is in the catalog but not on Together. */
  readonly title: TitleRow;
  /** One entry per live member: this device's member first, then the others by creation. */
  readonly ratings: readonly RatingView[];
  /** Personal status per live member, in the same order as `ratings`. */
  readonly personal: readonly MemberStatusView[];
  /** Recommendations of this title between the members (any state except removed), newest first. */
  readonly recommendations: readonly RecommendationView[];
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

/** The member whose list `scope` names (null before "who am I", or when there is no partner yet). */
const scopeMember = (db: Database, scope: Exclude<ListScope, 'together'>): string | null => (scope === 'me' ? currentMemberId(db) : partnerId(db));

/**
 * Live titles of a tab with both verdicts; `filter` applies the verdict-agreement chips. `scope` picks the list:
 * Together (titles with a Together status; those with status NULL are excluded), or a member's personal list.
 */
export function list(db: Database, tab: ListTab, filter?: VerdictFilter, scope: ListScope = 'together'): ListItem[] {
  const me = currentMemberId(db);
  const partner = partnerId(db);
  let rows: { t: TitleRow; status: Status; watchedOn: LocalDate | null; currentSeason: number | null }[];
  let inScope: string;
  let scopeParams: (string | number)[];
  if (scope === 'together') {
    const statuses = TAB_STATUSES[tab];
    const marks = statuses.map(() => '?').join(', ');
    rows = db
      .selectObjects(`SELECT * FROM titles WHERE ${LIVE} AND status IN (${marks}) ORDER BY ${TAB_ORDER[tab]}`, [...statuses])
      .map(rowToTitle)
      .map((t) => ({ t, status: t.status!, watchedOn: t.watchedOn, currentSeason: t.currentSeason }));
    inScope = `t.status IN (${marks})`;
    scopeParams = [...statuses];
  } else {
    const who = scopeMember(db, scope);
    if (who === null) return [];
    const statuses = MEMBER_TAB_STATUSES[tab];
    const marks = statuses.map(() => '?').join(', ');
    rows = db
      .selectObjects(
        `SELECT t.*, ms.status AS p_status, ms.watched_on AS p_watched_on, ms.current_season AS p_season
           FROM titles t JOIN member_status ms ON ms.title_id = t.id AND ms.member_id = ? AND ms.deleted_at IS NULL
          WHERE t.deleted_at IS NULL AND t.merged_into IS NULL AND ms.status IN (${marks}) ORDER BY ${MEMBER_TAB_ORDER[tab]}`,
        [who, ...statuses],
      )
      .map((r) => ({
        t: rowToTitle(r), status: text(r['p_status'], 'status') as Status, watchedOn: textOrNull(r['p_watched_on'], 'watched_on') as LocalDate | null,
        currentSeason: intOrNull(r['p_season'], 'current_season'),
      }));
    inScope = `t.id IN (SELECT title_id FROM member_status WHERE member_id = ? AND deleted_at IS NULL AND status IN (${marks}))`;
    scopeParams = [who, ...statuses];
  }
  const verdicts = new Map<string, Verdict>();
  for (const r of db.selectObjects(
    `SELECT r.title_id, r.member_id, r.verdict FROM ratings r JOIN titles t ON t.id = r.title_id
      WHERE r.deleted_at IS NULL AND r.verdict IS NOT NULL AND t.deleted_at IS NULL AND t.merged_into IS NULL AND ${inScope}`,
    scopeParams,
  )) {
    verdicts.set(`${text(r['title_id'], 'title_id')}|${text(r['member_id'], 'member_id')}`, text(r['verdict'], 'verdict') as Verdict);
  }
  const items: ListItem[] = rows.map(({ t, status, watchedOn, currentSeason }) => ({
    id: t.id, kind: t.kind, title: t.title, year: t.year, posterUrl: t.posterUrl, status, watchedOn, currentSeason, seasonCount: t.seasonCount,
    mine: me ? (verdicts.get(`${t.id}|${me}`) ?? null) : null,
    partner: partner ? (verdicts.get(`${t.id}|${partner}`) ?? null) : null,
  }));
  return filter ? filterByVerdict(filter, items, (i) => [i.mine, i.partner]) : items;
}

const recommendationState = (r: { answered: string | null; withdrawnAt: string | null }): RecommendationState =>
  r.answered === 'accepted' ? 'accepted' : r.answered === 'dismissed' ? 'dismissed' : r.withdrawnAt !== null ? 'withdrawn' : 'open';

/** Every member's name by id, removed ones too (a recommendation may name a member who left). */
function memberNames(db: Database): Map<string, string> {
  return new Map(db.selectObjects('SELECT * FROM members').map(rowToMember).map((m) => [m.id as string, m.name as string]));
}

/**
 * Recommendations to this device's member that are still open: not answered, not withdrawn, on a live title, and the
 * member has no personal status for it yet. They are shown at the top of the member's Watch later. Newest first.
 */
export function pendingRecommendations(db: Database): PendingRecommendation[] {
  const me = currentMemberId(db);
  if (me === null) return [];
  const names = memberNames(db);
  return db
    .selectObjects(
      `SELECT r.*, t.kind AS t_kind, t.title AS t_title, t.year AS t_year, t.poster_url AS t_poster
         FROM recommendations r JOIN titles t ON t.id = r.title_id
        WHERE r.to_member = ? AND r.answered IS NULL AND r.withdrawn_at IS NULL AND r.deleted_at IS NULL AND t.deleted_at IS NULL AND t.merged_into IS NULL
          AND NOT EXISTS (SELECT 1 FROM member_status ms WHERE ms.title_id = r.title_id AND ms.member_id = r.to_member AND ms.deleted_at IS NULL AND ms.status IS NOT NULL)
        ORDER BY r.created_at DESC, r.id`,
      [me],
    )
    .map((row) => {
      const r = rowToRecommendation(row);
      return {
        id: r.id, titleId: r.titleId, fromMember: r.fromMember, fromName: names.get(r.fromMember) ?? '', toMember: r.toMember, toName: names.get(r.toMember) ?? '',
        fromMe: false, toMe: true, state: 'open' as const, createdAt: r.createdAt,
        kind: text(row['t_kind'], 'kind') as Kind, title: text(row['t_title'], 'title'), year: intOrNull(row['t_year'], 'year'), posterUrl: textOrNull(row['t_poster'], 'poster_url'),
      };
    });
}

/** A live, unmerged title with the rating of every live member; null when absent, removed or merged away. */
export function titleDetail(db: Database, id: string): TitleDetail | null {
  const r = db.selectObject(`SELECT * FROM titles WHERE id = ? AND ${LIVE}`, [id]);
  if (!r) return null;
  const title = rowToTitle(r);
  const byMember = new Map(
    db.selectObjects('SELECT * FROM ratings WHERE title_id = ? AND deleted_at IS NULL', [id]).map(rowToRating).map((x) => [x.memberId as string, x]),
  );
  const live = members(db);
  const ratings = live.map((m) => {
    const x = byMember.get(m.id);
    return { memberId: m.id, name: m.name, verdict: x?.verdict ?? null, review: x?.review ?? null, mine: m.me };
  });
  const statusByMember = new Map(
    db.selectObjects('SELECT * FROM member_status WHERE title_id = ? AND deleted_at IS NULL', [id]).map(rowToMemberStatus).map((x) => [x.memberId as string, x]),
  );
  const personal = live.map((m) => {
    const x = statusByMember.get(m.id);
    return { memberId: m.id, name: m.name, mine: m.me, status: x?.status ?? null, watchedOn: x?.watchedOn ?? null, currentSeason: x?.currentSeason ?? null };
  });
  const me = currentMemberId(db);
  const names = memberNames(db);
  const recommendations = db
    .selectObjects('SELECT * FROM recommendations WHERE title_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id', [id])
    .map(rowToRecommendation)
    .map((r) => ({
      id: r.id, fromMember: r.fromMember, fromName: names.get(r.fromMember) ?? '', toMember: r.toMember, toName: names.get(r.toMember) ?? '',
      fromMe: r.fromMember === me, toMe: r.toMember === me, state: recommendationState(r), createdAt: r.createdAt,
    }));
  return { title, ratings, personal, recommendations };
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
