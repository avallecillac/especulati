import type { Change as SyncChange, FieldValue } from '@especulati/sync-core';
import type { MemberRow, MemberStatusRow, RatingRow, RecommendationRow, TitleRow } from './rows.ts';
import type { Hlc } from '@especulati/sync-core';
import type { Answer, Kind, MemberStatus, Status, Verdict } from './types.ts';

export type { FieldValue };
export type Table = 'titles' | 'members' | 'ratings' | 'member_status' | 'recommendations';
export type Change = SyncChange<Table>;

/** Details a TMDB result (or a person) can fill in. `undefined` = leave alone; `null` = clear (edit only). */
export interface TitleDetails {
  readonly originalTitle?: string | null;
  readonly year?: number | null;
  readonly posterUrl?: string | null;
  readonly genres?: readonly string[] | null;
  readonly runtimeMin?: number | null;
  readonly seasonCount?: number | null;
}

/**
 * Commands carry raw user input plus shell-generated ids (derived ids are hashed in the shell from
 * core's labels); decide() parses the input. `mediaKind` is the title's kind, since `kind` names the command.
 */
export type Command =
  | ({
      readonly kind: 'AddTitle';
      readonly titleId: string;
      readonly mediaKind: Kind;
      readonly title: string;
      readonly tmdbId?: number | null;
      readonly status?: Status;
      /** Required for dropped, optional for watched (unknown date); ignored otherwise. */
      readonly watchedOn?: string;
      readonly addedBy: string;
      /**
       * D3: `together` (default) is the shared list. `me` creates the title without a Together status and sets
       * `status` (a personal status, never dropped) on `addedBy`'s own list; `memberStatusId` is then required.
       */
      readonly to?: 'together' | 'me';
      readonly memberStatusId?: string;
    } & TitleDetails)
  | ({ readonly kind: 'EditTitleDetails'; readonly titleId: string; readonly title?: string } & TitleDetails)
  | { readonly kind: 'LinkToTmdb'; readonly titleId: string; readonly tmdbId: number; readonly details: TitleDetails & { readonly title?: string } }
  | { readonly kind: 'RemoveTitle'; readonly titleId: string }
  | { readonly kind: 'RestoreTitle'; readonly titleId: string }
  /** `watchedOn` is required for dropped, optional for watched, and ignored (cleared) for later and watching. */
  | { readonly kind: 'SetStatus'; readonly titleId: string; readonly status: Status; readonly watchedOn?: string }
  | { readonly kind: 'SetCurrentSeason'; readonly titleId: string; readonly season: number }
  /**
   * Ratings: `memberId` is the member whose rating is written; it must be the device's member
   * (`Snapshot.deviceMemberId`). `ratingId` is derived in the shell from (title, member). `verdict` null clears.
   */
  | { readonly kind: 'SetVerdict'; readonly titleId: string; readonly memberId: string; readonly ratingId: string; readonly verdict: Verdict | null }
  /** `review` is raw input: trimmed, empty means none, at most 1,000 characters. */
  | { readonly kind: 'SetReview'; readonly titleId: string; readonly memberId: string; readonly ratingId: string; readonly review: string }
  /**
   * D2: personal status. `memberId` is the member whose list is written and must be the device's member
   * (`NotYourList` otherwise); `memberStatusId` is derived in the shell from (title, member). `status` null takes
   * the title off the list. `watchedOn` is optional for watched and ignored otherwise.
   */
  | { readonly kind: 'SetMyStatus'; readonly titleId: string; readonly memberId: string; readonly memberStatusId: string; readonly status: MemberStatus | null; readonly watchedOn?: string }
  | { readonly kind: 'SetMySeason'; readonly titleId: string; readonly memberId: string; readonly memberStatusId: string; readonly season: number }
  /** `fromMember` must be the device's member; `recommendationId` is derived in the shell from (title, from, to). */
  | { readonly kind: 'Recommend'; readonly titleId: string; readonly fromMember: string; readonly toMember: string; readonly recommendationId: string }
  /** Only the recommender (`NotYours` otherwise). */
  | { readonly kind: 'WithdrawRecommendation'; readonly id: string }
  /**
   * Only the recipient (`memberId` = the device's member). `titleId` must be the recommendation's title (the shell
   * derives `memberStatusId` from it). Accepting also gives the member a Watch later status unless they have one.
   */
  | { readonly kind: 'AnswerRecommendation'; readonly id: string; readonly titleId: string; readonly memberId: string; readonly memberStatusId: string; readonly answer: Answer }
  | { readonly kind: 'CreateMember'; readonly memberId: string; readonly name: string }
  | { readonly kind: 'RenameMember'; readonly memberId: string; readonly name: string }
  /** Tombstone, used for duplicate members. Not allowed for the member this device acts as. */
  | { readonly kind: 'RemoveMember'; readonly memberId: string }
  /**
   * D4 reconcile of two rows with the same (tmdb_id, kind). `tmdbTitleId` is the TMDB-derived id of
   * that pair (hashed in the shell), or null when unknown; the survivor is the row with that id, else the
   * smaller id. `ratingIds` are the derived rating ids the shell computed for (title, member) of both rows;
   * they are used only when the survivor has no rating row yet for a member the loser has rated.
   */
  | {
      readonly kind: 'ReconcileTitles';
      readonly titleA: string;
      readonly titleB: string;
      readonly tmdbTitleId: string | null;
      readonly ratingIds: readonly { readonly titleId: string; readonly memberId: string; readonly ratingId: string }[];
      /** Derived ids of the survivor's personal-status rows, used only when the survivor has none for a member the loser has. */
      readonly memberStatusIds?: readonly { readonly titleId: string; readonly memberId: string; readonly id: string }[];
      /** Likewise for recommendations, keyed by (title, from, to). */
      readonly recommendationIds?: readonly { readonly titleId: string; readonly fromMember: string; readonly toMember: string; readonly id: string }[];
    };

/** Per-field HLC of a row, keyed by DB column; a missing key means the field was never written. */
export type FieldClocks = Readonly<Partial<Record<string, Hlc>>>;
export interface ClockedTitle {
  readonly row: TitleRow;
  readonly clocks: FieldClocks;
}
export interface ClockedRating {
  readonly row: RatingRow;
  readonly clocks: FieldClocks;
}
export interface ClockedMemberStatus {
  readonly row: MemberStatusRow;
  readonly clocks: FieldClocks;
}
export interface ClockedRecommendation {
  readonly row: RecommendationRow;
  readonly clocks: FieldClocks;
}
/**
 * `first`/`second` are the rows named by `titleA`/`titleB` (null when absent); `ratings`, `memberStatuses` and
 * `recommendations` are EVERY row of that table on either title, any state.
 */
export interface ReconcileSnapshot {
  readonly first: ClockedTitle | null;
  readonly second: ClockedTitle | null;
  readonly ratings: readonly ClockedRating[];
  readonly memberStatuses?: readonly ClockedMemberStatus[];
  readonly recommendations?: readonly ClockedRecommendation[];
}

export type Rejection =
  | { readonly kind: 'TitleRequired' }
  | { readonly kind: 'NotFound' }
  | { readonly kind: 'NotASeries' }
  /** A rating command for a member other than the one this device acts as. */
  | { readonly kind: 'NotYourRating' }
  /** A personal-status write for a member other than the one this device acts as (D2). */
  | { readonly kind: 'NotYourList' }
  /** A recommendation written by someone other than its recommender (withdraw) or recipient (answer), or sent as another member. */
  | { readonly kind: 'NotYours' }
  /** The member is unknown or removed. */
  | { readonly kind: 'UnknownMember' }
  | { readonly kind: 'TooLong'; readonly field: 'review'; readonly max: number }
  /** `max` is the title's known season count, or null when only the lower bound failed. */
  | { readonly kind: 'SeasonOutOfRange'; readonly max: number | null }
  /** `id` is the existing entry (for a title, the one the UI opens instead). */
  | { readonly kind: 'AlreadyExists'; readonly id: string }
  /** Malformed ids, dates or out-of-range values: a programming or input error the UI can't normally produce. */
  | { readonly kind: 'InvalidInput'; readonly field: string; readonly reason: string };

export interface Decision {
  readonly changes: readonly Change[];
}

/**
 * What the db layer loads for a command (unused parts may be absent):
 * - `title`: the row with the command's `titleId`, in any state (null when absent).
 * - `member`: the row with the command's `memberId`, in any state (null when absent).
 * - `rating`: the row with the command's `ratingId`, in any state (null when absent).
 * - `memberStatus`: the `member_status` row with the command's `memberStatusId`, in any state.
 * - `recommendation`: the `recommendations` row with the command's `recommendationId` / `id`, in any state.
 * - `deviceMemberId`: `meta.member_id` (null before "who am I").
 * - `maxWatchOrder`: the greatest `watch_order` among live Together-watched titles (null when none); `AddTitle` and `SetStatus` only.
 */
export interface Snapshot {
  readonly title?: TitleRow | null;
  readonly member?: MemberRow | null;
  readonly rating?: RatingRow | null;
  readonly memberStatus?: MemberStatusRow | null;
  readonly recommendation?: RecommendationRow | null;
  readonly deviceMemberId?: string | null;
  readonly maxWatchOrder?: number | null;
  /** `ReconcileTitles` only; see {@link ReconcileSnapshot}. */
  readonly reconcile?: ReconcileSnapshot;
}
