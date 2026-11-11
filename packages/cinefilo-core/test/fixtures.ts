import type { Hlc, Instant, LocalDate, MemberId, MemberRow, RatingId, RatingRow, TitleId, TitleRow } from '../src/index.ts';

/** Deterministic lowercase v4-shaped UUIDs. */
export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const titleId = (n: number) => uuid(n) as TitleId;
export const memberId = (n: number) => uuid(100 + n) as MemberId;
export const ratingId = (n: number) => uuid(200 + n) as RatingId;
export const instant = (s: string) => s as Instant;
export const day = (s: string) => s as LocalDate;
export const hlc = (ms: number, device = 1): Hlc =>
  `${String(ms).padStart(13, '0')}-0000-${uuid(9000 + device)}` as Hlc;

export const NOW = instant('2026-09-27T12:00:00.000Z');

export function title(p: Partial<TitleRow> = {}): TitleRow {
  return {
    id: titleId(1), kind: 'movie', title: 'Stalker' as TitleRow['title'], originalTitle: null, year: 1979, tmdbId: null,
    posterUrl: null, genres: null, runtimeMin: null, seasonCount: null, status: 'later', watchedOn: null, currentSeason: null,
    mergedInto: null, addedBy: memberId(1), createdAt: instant('2026-09-01T10:00:00.000Z'), deletedAt: null, ...p,
  };
}
export function member(p: Partial<MemberRow> = {}): MemberRow {
  return { id: memberId(1), name: 'Ana' as MemberRow['name'], createdAt: instant('2026-09-01T10:00:00.000Z'), deletedAt: null, ...p };
}
export function rating(p: Partial<RatingRow> = {}): RatingRow {
  return {
    id: ratingId(1), titleId: titleId(1), memberId: memberId(1), verdict: null, review: null,
    updatedAt: instant('2026-09-02T10:00:00.000Z'), deletedAt: null, ...p,
  };
}
