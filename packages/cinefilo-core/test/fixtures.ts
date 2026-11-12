import type { Hlc, Instant, LocalDate, MemberId, MemberRow, MemberStatusId, MemberStatusRow, RatingId, RatingRow, RecommendationId, RecommendationRow, TitleId, TitleRow } from '../src/index.ts';

/** Deterministic lowercase v4-shaped UUIDs. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const titleId = (n: number) => uuid(n) as TitleId;
export const memberId = (n: number) => uuid(100 + n) as MemberId;
export const ratingId = (n: number) => uuid(200 + n) as RatingId;
export const msId = (n: number) => uuid(300 + n) as MemberStatusId;
export const recId = (n: number) => uuid(400 + n) as RecommendationId;
export const instant = (s: string) => s as Instant;
export const day = (s: string) => s as LocalDate;
export const hlc = (ms: number, device = 1): Hlc =>
  `${String(ms).padStart(13, '0')}-0000-${uuid(9000 + device)}` as Hlc;

export const NOW = instant('2026-09-27T12:00:00.000Z');

export function title(p: Partial<TitleRow> = {}): TitleRow {
  return {
    id: titleId(1), kind: 'movie', title: 'Stalker' as TitleRow['title'], originalTitle: null, year: 1979, tmdbId: null,
    posterUrl: null, genres: null, runtimeMin: null, seasonCount: null, status: 'later', watchedOn: null, currentSeason: null, watchOrder: null,
    mergedInto: null, addedBy: memberId(1), createdAt: instant('2026-09-01T10:00:00.000Z'), deletedAt: null, ...p,
  };
}
export function member(p: Partial<MemberRow> = {}): MemberRow {
  return { id: memberId(1), name: 'Ana' as MemberRow['name'], createdAt: instant('2026-09-01T10:00:00.000Z'), deletedAt: null, ...p };
}
export function rating(p: Partial<RatingRow> = {}): RatingRow {
  return {
    id: ratingId(1), titleId: titleId(1), memberId: memberId(1), verdict: null, stars: null, review: null,
    updatedAt: instant('2026-09-02T10:00:00.000Z'), deletedAt: null, ...p,
  };
}

export function memberStatus(p: Partial<MemberStatusRow> = {}): MemberStatusRow {
  return {
    id: msId(1), titleId: titleId(1), memberId: memberId(1), status: 'later', watchedOn: null, currentSeason: null,
    updatedAt: instant('2026-09-02T10:00:00.000Z'), deletedAt: null, ...p,
  };
}
export function recommendation(p: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    id: recId(1), titleId: titleId(1), fromMember: memberId(1), toMember: memberId(2),
    createdAt: instant('2026-09-02T10:00:00.000Z'), withdrawnAt: null, answered: null, answeredAt: null, deletedAt: null, ...p,
  };
}
