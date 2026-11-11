import type { LocalDate } from '@especulati/cinefilo-core';

const pad = (n: number) => String(n).padStart(2, '0');

/** A calendar date in the device's time zone, evaluated when called (at save time). */
export const localDate = (at: Date = new Date()): LocalDate => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` as LocalDate;

export const todayLocal = (at: Date = new Date()): LocalDate => localDate(at);

/** The previous calendar day, not "now minus 24h", which breaks across DST. */
export const yesterdayLocal = (at: Date = new Date()): LocalDate => localDate(new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1));
