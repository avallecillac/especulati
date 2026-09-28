import { onChanged, query } from './dbClient.ts';

export { coverHue, initials } from './coverArt.ts';

/** Object URLs by item id; `null` caches "no cover". */
const cache = new Map<string, string | null>();

// Covers can be stored or deleted at any time: drop everything on any change.
onChanged(() => {
  for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
  cache.clear();
});

export async function coverObjectUrl(itemId: string): Promise<string | null> {
  if (cache.has(itemId)) return cache.get(itemId) ?? null;
  const r = await query({ name: 'cover', itemId });
  const url = r.ok && r.value ? URL.createObjectURL(r.value) : null;
  // A change may have cleared the cache while we waited; a stale entry is harmless but revoke duplicates.
  const existing = cache.get(itemId);
  if (existing) {
    if (url) URL.revokeObjectURL(url);
    return existing;
  }
  cache.set(itemId, url);
  return url;
}
