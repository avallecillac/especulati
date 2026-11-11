import type { OpWire } from '@especulati/sync-core';
import type { Envelope } from './envelope.ts';
import type { RelayClient, RelayFailure } from './relayClient.ts';

export const PUSH_LIMIT = 500;

type MaybePromise<T> = T | Promise<T>;

/**
 * Where unpushed local ops live. The token is opaque to the pusher: the DB adapter uses a
 * change_log seq, a capture peer with an in-memory `pending: OpWire[]` uses a count.
 * This file knows no app and no SQLite (dependency-cruiser `shared-no-apps-domain`).
 */
export interface PushSource<T = unknown> {
  /**
   * Up to `limit` unpushed ops. With `upTo` (the token of an earlier batch) only ops that batch
   * covered are returned, so a re-sent batch carries the same content. No ops: token is irrelevant.
   */
  next(limit: number, upTo?: T): MaybePromise<{ ops: OpWire[]; token: T }>;
  /** Everything up to and including `token` reached the relay. */
  complete(token: T): MaybePromise<void>;
  /** The batch that may or may not have reached the relay, if any. */
  pending(): MaybePromise<{ batchId: string; token: T } | null>;
  /** Persist the batch about to be POSTed (before the POST), so a crash re-sends the same id. */
  setPending(p: { batchId: string; token: T } | null): MaybePromise<void>;
}

export interface PushDeps {
  client: Pick<RelayClient, 'postBatch'>;
  /** Encrypts `ops` under `batchId`. */
  seal(ops: OpWire[], batchId: string): Promise<Envelope>;
  newBatchId(): string;
}

export interface PushOutcome {
  /** Ops sent (and completed) by this call. */
  pushed: number;
  failure: RelayFailure | null;
}

/** Re-send the pending batch with its id, then push everything else in batches of up to 500. */
export async function pushAll<T>(source: PushSource<T>, deps: PushDeps): Promise<PushOutcome> {
  const out: PushOutcome = { pushed: 0, failure: null };

  async function send(batchId: string, token: T): Promise<RelayFailure | null> {
    const batch = await source.next(PUSH_LIMIT, token);
    if (batch.ops.length === 0) {
      await source.complete(token);
      return null;
    }
    const env = await deps.seal(batch.ops, batchId);
    const r = await deps.client.postBatch(env);
    if (!r.ok) return r;
    // `duplicate: true` means an earlier attempt landed: also success.
    await source.complete(token);
    out.pushed += batch.ops.length;
    return null;
  }

  const pending = await source.pending();
  if (pending) {
    out.failure = await send(pending.batchId, pending.token);
    if (out.failure) return out;
  }
  for (;;) {
    const { ops, token } = await source.next(PUSH_LIMIT);
    if (ops.length === 0) return out;
    const batchId = deps.newBatchId();
    await source.setPending({ batchId, token });
    out.failure = await send(batchId, token);
    if (out.failure) return out;
  }
}
