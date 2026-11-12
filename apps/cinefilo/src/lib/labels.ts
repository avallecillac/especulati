import type { Kind, MemberStatus, Status } from '@especulati/cinefilo-core';

export const STATUS_LABEL: Readonly<Record<Status, string>> = { later: 'Watch later', watching: 'Watching', watched: 'Watched', dropped: 'Dropped' };

/** Statuses a title of this kind can have (movies cannot be watching or dropped). */
export const statusesFor = (kind: Kind): readonly Status[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched', 'dropped']);

export const KIND_LABEL: Readonly<Record<Kind, string>> = { movie: 'Movie', series: 'Series' };

/** Personal statuses of a title of this kind: no dropped, and movies cannot be watching. */
export const memberStatusesFor = (kind: Kind): readonly MemberStatus[] => (kind === 'movie' ? ['later', 'watched'] : ['later', 'watching', 'watched']);

/** Half stars (1..10) as text: "0.5 stars", "1 star", "3.5 stars". */
export const starsText = (halves: number): string => `${halves / 2} ${halves === 2 ? 'star' : 'stars'}`;

/** Accessible name of a member's rating: "You: 3.5 stars" or "Luz: not rated". */
export const ratingLabel = (name: string, halves: number | null): string => `${name}: ${halves ? starsText(halves) : 'not rated'}`;
