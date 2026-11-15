let names: Intl.DisplayNames | null | undefined;

/** The English name of an ISO 3166-1 alpha-2 code (`Intl.DisplayNames`), or the code itself when unknown (cinefilo-tmdb-credits D1). */
export function countryName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}
