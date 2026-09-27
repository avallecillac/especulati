import { previousLocalDate, type Instant, type LocalDate } from '@readerlog/core';

export const nowInstant = (): Instant => new Date().toISOString() as Instant;

/** Today's calendar date in the device's current time zone, evaluated at call (save) time. */
export function todayLocal(at: Date = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}` as LocalDate;
}

/** The previous calendar day — not "now minus 24h", which breaks across DST (research R6). */
export const yesterdayLocal = (at: Date = new Date()): LocalDate => previousLocalDate(todayLocal(at));
