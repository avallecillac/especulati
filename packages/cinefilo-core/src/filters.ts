import type { Verdict } from './types.ts';

/** Verdict-agreement filters of the lists (cinefilo-ratings), in chip order. */
export const VERDICT_FILTERS = ['bothLiked', 'disagree', 'onlyMe', 'partnerNotRated', 'nobody'] as const;
export type VerdictFilter = (typeof VERDICT_FILTERS)[number];

/** Whether a title with these two verdicts (null = not rated) passes `filter`. */
export function matchesVerdictFilter(filter: VerdictFilter, mine: Verdict | null, partner: Verdict | null): boolean {
  switch (filter) {
    case 'bothLiked':
      return mine === 'like' && partner === 'like';
    case 'disagree':
      return mine !== null && partner !== null && mine !== partner;
    case 'onlyMe':
      return mine !== null && partner === null;
    case 'partnerNotRated':
      return partner === null;
    case 'nobody':
      return mine === null && partner === null;
  }
}

/** Keep the items that pass, in their order. `verdictsOf` returns `[mine, partner]`. */
export function filterByVerdict<T>(
  filter: VerdictFilter,
  items: readonly T[],
  verdictsOf: (item: T) => readonly [Verdict | null, Verdict | null],
): T[] {
  return items.filter((i) => {
    const [mine, partner] = verdictsOf(i);
    return matchesVerdictFilter(filter, mine, partner);
  });
}
