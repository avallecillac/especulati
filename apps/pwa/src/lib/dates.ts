const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Fixed English month abbreviation for a 1-based month (not locale-dependent, so tests are stable). */
export const monthAbbr = (month: number): string => MONTHS[month - 1] ?? '';

/** "2026-03-03" → "Mar 3". */
export const shortDate = (iso: string): string => `${monthAbbr(Number(iso.slice(5, 7)))} ${Number(iso.slice(8, 10))}`;

/** "2026-03-03" → "Mar 3, 2026". */
export const longDate = (iso: string): string => `${shortDate(iso)}, ${iso.slice(0, 4)}`;
