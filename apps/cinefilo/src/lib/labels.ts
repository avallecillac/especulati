import type { Kind, MemberStatus, Status } from '@especulati/cinefilo-core';

export const STATUS_LABEL: Readonly<Record<Status, string>> = { later: 'Watch later', watching: 'Watching', watched: 'Watched', dropped: 'Dropped' };

/** Statuses a title of this kind can have (movies cannot be watching or dropped). */
export const statusesFor = (kind: Kind): readonly Status[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched', 'dropped']);

export const KIND_LABEL: Readonly<Record<Kind, string>> = { movie: 'Movie', series: 'Series' };

/** Personal statuses of a title of this kind: no dropped, and movies cannot be watching. */
export const memberStatusesFor = (kind: Kind): readonly MemberStatus[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched']);
