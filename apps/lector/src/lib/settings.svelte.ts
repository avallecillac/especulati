import { query, setMeta } from './dbClient.ts';

const KEY = 'google_books_api_key';

/** Per-device settings. The Google Books key lives only in the local meta table ('' = no key). */
export const settings = $state<{ googleBooksKey: string }>({ googleBooksKey: '' });

/** Load once when the DB is ready. */
export async function loadSettings(): Promise<void> {
  const r = await query({ name: 'setting', key: KEY });
  if (r.ok && r.value) settings.googleBooksKey = r.value;
}

export async function saveGoogleKey(key: string): Promise<void> {
  const trimmed = key.trim();
  await setMeta(KEY, trimmed);
  settings.googleBooksKey = trimmed;
}

export const removeGoogleKey = (): Promise<void> => saveGoogleKey('');

/** The only form of the key that may appear in the UI. */
export const maskKey = (key: string): string => `••••${key.slice(-4)}`;
