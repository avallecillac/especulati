export interface StoredBatch {
  seq: number;
  batchId: string;
  iv: string;
  ct: string;
}

/** Storage port for the relay. Adapters: D1 (`d1Store.ts`) and SQLite-WASM (tests). */
export interface RelayStore {
  getSpace(id: string): Promise<{ tokenHash: string } | null>;
  /** false if the space already exists. */
  createSpace(id: string, tokenHash: string, now: number): Promise<boolean>;
  deleteSpace(id: string): Promise<void>;
  appendBatch(
    id: string,
    b: { batchId: string; iv: string; ct: string },
    now: number,
  ): Promise<{ seq: number; duplicate: boolean }>;
  listBatches(id: string, after: number, limit: number): Promise<StoredBatch[]>;
  /** Increments the counter for this minute bucket and returns the new count. */
  hit(id: string, minute: number): Promise<number>;
  prune(minuteBefore: number): Promise<void>;
}
