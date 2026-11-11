import type { Kind, MemberStatus, Status, Verdict, VerdictFilter } from '@especulati/cinefilo-core';

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = { like: 'Like', meh: 'Meh', dislike: "Didn't like" };

export const FILTER_LABEL: Readonly<Record<VerdictFilter, string>> = {
  bothLiked: 'Both liked',
  disagree: 'Disagree',
  onlyMe: 'Only me',
  partnerNotRated: "Partner hasn't rated",
  nobody: 'Nobody rated',
};

export const STATUS_LABEL: Readonly<Record<Status, string>> = { later: 'Watch later', watching: 'Watching', watched: 'Watched', dropped: 'Dropped' };

/** Statuses a title of this kind can have (movies cannot be watching or dropped). */
export const statusesFor = (kind: Kind): readonly Status[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched', 'dropped']);

export const KIND_LABEL: Readonly<Record<Kind, string>> = { movie: 'Movie', series: 'Series' };

/** Personal statuses of a title of this kind: no dropped, and movies cannot be watching. */
export const memberStatusesFor = (kind: Kind): readonly MemberStatus[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched']);
