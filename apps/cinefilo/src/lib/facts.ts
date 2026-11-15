import type { Kind } from '@especulati/cinefilo-core';
import { countryName } from './countries.ts';

interface Facts {
  readonly kind: Kind;
  readonly genres: readonly string[] | null;
  readonly countries: readonly string[] | null;
  readonly directors: readonly string[] | null;
  readonly leadActor: string | null;
  readonly leadActress: string | null;
}

/**
 * The lines under a title's year (cinefilo-tmdb-credits D6): "Italy · France · Drama · Crime", "Directed by A, B"
 * (a series: "Created by"), "With <actor>, <actress>". A part with nothing to show leaves its line out.
 */
export function detailLines(t: Facts): string[] {
  const lines: string[] = [];
  const first = [...(t.countries ?? []).map(countryName), ...(t.genres ?? []).slice(0, 3)];
  if (first.length > 0) lines.push(first.join(' · '));
  if (t.directors && t.directors.length > 0) lines.push(`${t.kind === 'series' ? 'Created' : 'Directed'} by ${t.directors.join(', ')}`);
  const leads = [t.leadActor, t.leadActress].filter((n): n is string => !!n);
  if (leads.length > 0) lines.push(`With ${leads.join(', ')}`);
  return lines;
}
