import type { Instant, Kind, LocalDate, MemberId, MemberName, NonEmptyTitle, RatingId, Review, Status, TitleId, Verdict } from './types.ts';

/** A `titles` row as core sees it. `genres` is the decoded JSON array (the DB stores it as text). */
export interface TitleRow {
  readonly id: TitleId;
  readonly kind: Kind;
  readonly title: NonEmptyTitle;
  readonly originalTitle: string | null;
  readonly year: number | null;
  readonly tmdbId: number | null;
  readonly posterUrl: string | null;
  readonly genres: readonly string[] | null;
  readonly runtimeMin: number | null;
  readonly seasonCount: number | null;
  readonly status: Status;
  readonly watchedOn: LocalDate | null;
  readonly currentSeason: number | null;
  readonly mergedInto: TitleId | null;
  readonly addedBy: MemberId;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

export interface MemberRow {
  readonly id: MemberId;
  readonly name: MemberName;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
}

export interface RatingRow {
  readonly id: RatingId;
  readonly titleId: TitleId;
  readonly memberId: MemberId;
  readonly verdict: Verdict | null;
  readonly review: Review | null;
  readonly updatedAt: Instant;
  readonly deletedAt: Instant | null;
}

/** `genres` column text for a decoded list (null stays null). */
export const genresToDb = (g: readonly string[] | null): string | null => (g === null ? null : JSON.stringify(g));

/** Decode the `genres` column; null when absent or not a JSON array of strings. */
export function genresFromDb(s: string | null): readonly string[] | null {
  if (s === null) return null;
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v) : null;
  } catch {
    return null;
  }
}
