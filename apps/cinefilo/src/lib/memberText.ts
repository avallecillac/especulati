import type { MemberActivity } from '@especulati/cinefilo-db';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "12 ratings · 3 reviews · 40 on their list · 2 recommendations · 15 added"; zero counts are left out (cinefilo-member-cleanup D2). */
export function activityParts(a: MemberActivity): string[] {
  return [
    a.ratings > 0 ? plural(a.ratings, 'rating', 'ratings') : '',
    a.reviews > 0 ? plural(a.reviews, 'review', 'reviews') : '',
    a.personal > 0 ? `${a.personal} on their list` : '',
    a.recommendations > 0 ? plural(a.recommendations, 'recommendation', 'recommendations') : '',
    a.titlesAdded > 0 ? `${a.titlesAdded} added` : '',
  ].filter((x) => x !== '');
}

export const activityLine = (a: MemberActivity): string => (a.total === 0 ? 'No activity yet' : activityParts(a).join(' · '));
