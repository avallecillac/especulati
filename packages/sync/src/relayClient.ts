import type { Envelope } from './envelope.ts';

/** How a relay call ended. Nothing here carries a URL, token, space id or body (FR-005). */
export type RelayFailure =
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'notFound' }
  | { kind: 'conflict' }
  | { kind: 'relay'; status?: number };
export type RelayResult<T> = { ok: true; value: T } | ({ ok: false } & RelayFailure);

export interface StoredBatch extends Envelope {
  seq: number;
}

export interface RelayClient {
  createSpace(): Promise<RelayResult<null>>;
  spaceExists(): Promise<RelayResult<null>>;
  deleteSpace(): Promise<RelayResult<null>>;
  postBatch(e: Envelope): Promise<RelayResult<{ seq: number; duplicate: boolean }>>;
  getBatches(after: number, limit: number): Promise<RelayResult<{ batches: StoredBatch[]; more: boolean }>>;
}

const TIMEOUT_MS = 20_000;

export function createRelayClient(fetchFn: typeof fetch, spaceId: string, authToken: string, online: () => boolean): RelayClient {
  const base = `/api/v1/spaces/${spaceId}`;

  async function call(method: string, path: string, body?: unknown): Promise<RelayResult<unknown>> {
    if (!online()) return { ok: false, kind: 'offline' };
    let res: Response;
    try {
      const init: RequestInit = {
        method,
        headers: { authorization: `Bearer ${authToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      res = await fetchFn(base + path, init);
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      // A timeout means the relay is slow, not that we are offline.
      return name === 'TimeoutError' || name === 'AbortError' ? { ok: false, kind: 'relay' } : { ok: false, kind: 'offline' };
    }
    if (res.status === 401) return { ok: false, kind: 'unauthorized' };
    if (res.status === 404) return { ok: false, kind: 'notFound' };
    if (res.status === 409) return { ok: false, kind: 'conflict' };
    if (!res.ok) return { ok: false, kind: 'relay', status: res.status };
    if (res.status === 204) return { ok: true, value: null };
    try {
      return { ok: true, value: (await res.json()) as unknown };
    } catch {
      return { ok: false, kind: 'relay', status: res.status };
    }
  }

  const empty = async (method: string): Promise<RelayResult<null>> => {
    const r = await call(method, '');
    return r.ok ? { ok: true, value: null } : r;
  };
  const malformed: RelayResult<never> = { ok: false, kind: 'relay' };

  return {
    createSpace: () => empty('PUT'),
    spaceExists: () => empty('GET'),
    deleteSpace: () => empty('DELETE'),
    async postBatch(e) {
      const r = await call('POST', '/batches', { batchId: e.batchId, iv: e.iv, ct: e.ct });
      if (!r.ok) return r;
      const v = r.value as { seq?: unknown; duplicate?: unknown } | null;
      if (typeof v?.seq !== 'number' || typeof v.duplicate !== 'boolean') return malformed;
      return { ok: true, value: { seq: v.seq, duplicate: v.duplicate } };
    },
    async getBatches(after, limit) {
      const r = await call('GET', `/batches?after=${after}&limit=${limit}`);
      if (!r.ok) return r;
      const v = r.value as { batches?: unknown; more?: unknown } | null;
      if (!Array.isArray(v?.batches) || typeof v.more !== 'boolean') return malformed;
      const batches: StoredBatch[] = [];
      for (const b of v.batches as Record<string, unknown>[]) {
        if (typeof b.seq !== 'number' || typeof b.batchId !== 'string' || typeof b.iv !== 'string' || typeof b.ct !== 'string') return malformed;
        batches.push({ seq: b.seq, batchId: b.batchId, iv: b.iv, ct: b.ct });
      }
      return { ok: true, value: { batches, more: v.more } };
    },
  };
}
