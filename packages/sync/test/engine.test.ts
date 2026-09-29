import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.ts';
import { seal, type Plain } from '../src/envelope.ts';
import { fakeRelay, makePeer, uuid, type FakeRelay, type Peer } from './harness.ts';

let itemN = 0;
function addBook(p: Peer, title = 'Book'): string {
  p.tick();
  const id = uuid(0x500000 + ++itemN);
  const r = p.db.dispatch({ kind: 'AddBook', itemId: id, title, startNow: false, localDate: '2026-09-01' }, p.env);
  expect(r.ok).toBe(true);
  return id;
}
const titles = (p: Peer) => p.db.raw.selectValues('SELECT title FROM items ORDER BY id').map(String);
const gets = (r: FakeRelay) => r.log.filter((x) => x.method === 'GET' && x.path.includes('/batches')).length;
const posts = (r: FakeRelay) => r.log.filter((x) => x.method === 'POST').length;

/** A peer with sync turned on, holding a space on `relay`. */
async function startSpace(relay: FakeRelay, n = 1): Promise<Peer> {
  const a = makePeer(n, relay);
  const r = await a.engine.turnOn();
  expect(r.ok).toBe(true);
  return a;
}
async function joinSpace(relay: FakeRelay, host: Peer, n: number): Promise<Peer> {
  const b = makePeer(n, relay);
  const code = host.engine.showCode()!.code;
  const r = await b.engine.join(code);
  expect(r.ok).toBe(true);
  return b;
}

/** Post a hand-made envelope straight to the relay, as some other device would. */
async function postRaw(relay: FakeRelay, host: Peer, plain: unknown, opts: { sealAs?: string; postAs?: string } = {}): Promise<void> {
  const code = host.engine.showCode()!.code;
  const { parseSyncCode } = await import('../src/code.ts');
  const k = parseSyncCode(code);
  if (!k.ok) throw new Error('code');
  const keys = await deriveKeys(k.value);
  const batchId = opts.postAs ?? uuid(0x900000 + ++itemN);
  const env = await seal(plain as Plain, keys.encKey, keys.spaceId, opts.sealAs ?? batchId);
  const res = await relay.fetch(`/api/v1/spaces/${keys.spaceId}/batches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${keys.authToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...env, batchId }),
  });
  expect(res.status).toBe(200);
}
const goodOp = (n: number, title: string) => ({
  op: uuid(0xa00000 + n),
  hlc: `${String(Date.UTC(2026, 8, 27, 13, 0, 0) + n).padStart(13, '0')}-0000-${uuid(0xfeed)}`,
  tbl: 'items',
  row: uuid(0xb00000 + n),
  fields: { type: 'book', title, created_at: '2026-09-01T10:00:00.000Z' },
});

describe('engine: basics', () => {
  it('run() with sync off is a no-op', async () => {
    const relay = fakeRelay();
    const p = makePeer(1, relay);
    addBook(p);
    expect(await p.engine.run('manual')).toMatchObject({ pulled: 0, pushed: 0, changed: false });
    expect(relay.log).toEqual([]);
    expect(p.engine.status().on).toBe(false);
  });

  it('two devices converge through the relay; own batches pulled back are harmless', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    addBook(a, 'Dune');
    const own = await a.engine.run('manual');
    expect(own.changed).toBe(false); // it pulled its own batch back: nothing new
    const b = await joinSpace(relay, a, 2);
    expect(titles(b)).toEqual(['Dune']);
    addBook(b, 'Emma');
    expect((await b.engine.run('write')).pushed).toBeGreaterThan(0);
    const r = await a.engine.run('visible');
    expect(r.changed).toBe(true);
    expect(titles(a).sort()).toEqual(['Dune', 'Emma']);
    expect((await a.engine.run('visible')).changed).toBe(false);
    expect(a.engine.status()).toMatchObject({ on: true, pending: 0, problem: null });
  });

  it('pulls pages of 50 until more is false, advancing the cursor in each page transaction', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    for (let i = 0; i < 120; i++) {
      addBook(a, `B${i}`);
      await a.engine.run('write');
    }
    const b = makePeer(2, relay);
    relay.log.length = 0;
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    expect(relay.log.filter((x) => x.path.includes('after=')).map((x) => x.path.replace(/^.*\?/, ''))).toEqual([
      'after=0&limit=50',
      'after=50&limit=50',
      'after=100&limit=50',
    ]);
    expect(b.db.syncMeta().cursor).toBe(120 + 0);
    expect(titles(b)).toHaveLength(120);
  });

  it('pushes at most 500 ops per batch, persisting pending_batch before the POST and clearing it after', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    for (let i = 0; i < 1100; i++) addBook(a, `B${i}`);
    const seen: { pending: unknown; matches: boolean }[] = [];
    relay.before = ({ method, body }) => {
      if (method !== 'POST') return;
      const pending = a.db.syncMeta().pendingBatch;
      seen.push({ pending, matches: pending?.batchId === (JSON.parse(body!) as { batchId: string }).batchId });
    };
    expect((await a.engine.turnOn()).ok).toBe(true);
    expect(posts(relay)).toBe(3);
    expect(seen.every((s) => s.pending !== null && s.matches)).toBe(true);
    expect(a.db.syncMeta().pendingBatch).toBeNull();
    expect(a.db.pendingCount()).toBe(0);
    const b = await joinSpace(relay, a, 2);
    expect(titles(b)).toHaveLength(1100);
  });
});

describe('engine: crash and concurrency', () => {
  it('a lost response re-sends the same batchId; the relay says duplicate; nothing is applied twice', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    addBook(a, 'Dune');
    let crashed = false;
    relay.after = ({ method }) => {
      if (method === 'POST' && !crashed) {
        crashed = true;
        throw new TypeError('network died after the relay stored the batch');
      }
    };
    const r1 = await a.engine.run('write');
    expect(r1.problem).toBe('offline');
    const pending = a.db.syncMeta().pendingBatch;
    expect(pending).not.toBeNull();
    const sent: string[] = [];
    relay.before = ({ method, body }) => {
      if (method === 'POST') sent.push((JSON.parse(body!) as { batchId: string }).batchId);
    };
    const r2 = await a.engine.run('write');
    expect(sent).toEqual([pending!.batchId]);
    expect(r2.problem ?? null).toBeNull();
    expect(a.db.syncMeta().pendingBatch).toBeNull();
    expect(a.db.pendingCount()).toBe(0);
    // The relay holds the batch exactly once.
    const stored = relay.store.dumpAll().split('\n').filter((l) => l.includes('"batch_id"'));
    expect(stored.filter((l) => l.includes(pending!.batchId))).toHaveLength(1);
    await b.engine.run('visible');
    expect(titles(b)).toEqual(['Dune']);
    expect(b.db.raw.selectValue('SELECT COUNT(*) FROM items')).toBe(1);
  });

  it('one run at a time; a run() during a run sets run-again and runs once more', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    let first = true;
    relay.before = async ({ method, path }) => {
      if (first && method === 'GET' && path.includes('/batches')) {
        first = false;
        await gate;
      }
    };
    relay.log.length = 0;
    const r1 = a.engine.run('start');
    await new Promise((res) => setTimeout(res, 10));
    const r2 = a.engine.run('visible');
    const r3 = a.engine.run('manual'); // still only one extra run
    expect(gets(relay)).toBe(1);
    release();
    await Promise.all([r1, r2, r3]);
    expect(gets(relay)).toBe(2);
  });
});

describe('engine: errors', () => {
  it('offline: problem offline, nothing changed, and no request when online() is false', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    addBook(a, 'Dune');
    a.online = false;
    relay.log.length = 0;
    const before = a.db.pendingCount();
    const r = await a.engine.run('online');
    expect(r).toMatchObject({ pulled: 0, pushed: 0, changed: false, problem: 'offline' });
    expect(relay.log).toEqual([]);
    expect(a.db.pendingCount()).toBe(before);
    expect(a.engine.status().problem).toBe('offline');
    a.online = true;
    relay.before = () => {
      throw new TypeError('Failed to fetch');
    };
    expect((await a.engine.run('online')).problem).toBe('offline');
    expect(a.db.pendingCount()).toBe(before);
    relay.before = undefined;
    expect((await a.engine.run('online')).problem ?? null).toBeNull();
    expect(a.engine.status().problem).toBeNull();
    expect(a.db.pendingCount()).toBe(0);
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'spaceGone'],
  ] as const)('%i stops sync until rejoin (%s)', async (status, problem) => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    relay.before = () => new Response(JSON.stringify({ error: 'x' }), { status });
    const r = await a.engine.run('manual');
    expect(r.problem).toBe(problem);
    expect(r.backoffMs ?? null).toBeNull();
    relay.before = undefined;
    relay.log.length = 0;
    addBook(a);
    expect((await a.engine.run('write')).problem).toBe(problem);
    expect(relay.log).toEqual([]); // stopped
    expect(a.engine.status().problem).toBe(problem);
    // Rejoining clears it.
    const code = a.engine.showCode()!.code;
    expect((await a.engine.join(code)).ok).toBe(true);
    expect(a.engine.status().problem).toBeNull();
  });

  it('skips a batch that fails to decrypt or has bad ops, counts it, and advances the cursor', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(1, 'One')] });
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(2, 'Lost')] }, { sealAs: uuid(0x777) }); // wrong AAD
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(3, 'Half'), { ...goodOp(4, 'Bad'), tbl: 'nope' }] }); // one bad op poisons the batch
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(5, 'Five')] });
    const r = await b.engine.run('visible');
    expect(r.problem ?? null).toBeNull();
    expect(titles(b).sort()).toEqual(['Five', 'One']);
    expect(b.engine.status().undecryptable).toBe(2);
    expect(b.db.syncMeta().cursor).toBe(4);
    // Nothing is retried.
    relay.log.length = 0;
    await b.engine.run('visible');
    expect(b.engine.status().undecryptable).toBe(2);
  });

  it("a newer-version batch stops the cursor and reports 'newerVersion'", async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(1, 'One')] });
    await postRaw(relay, a, { v: 2, device: uuid(0xfeed), ops: [] });
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [goodOp(2, 'Two')] });
    const r = await b.engine.run('visible');
    expect(r.problem).toBe('newerVersion');
    expect(titles(b)).toEqual(['One']);
    expect(b.db.syncMeta().cursor).toBe(1);
    expect(b.engine.status().problem).toBe('newerVersion');
  });

  it("relay 5xx and timeouts give 'relay' with 30 s, 2 min, 10 min backoff, changing nothing", async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    addBook(a);
    const pending = a.db.pendingCount();
    relay.before = () => new Response('{"error":"x"}', { status: 503 });
    const delays: (number | null | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await a.engine.run('manual');
      expect(r.problem).toBe('relay');
      delays.push(r.backoffMs);
    }
    expect(delays).toEqual([30_000, 120_000, 600_000, 600_000, 600_000]);
    expect(a.db.pendingCount()).toBe(pending);
    relay.before = () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    };
    expect((await a.engine.run('manual')).problem).toBe('relay');
    relay.before = undefined;
    const ok = await a.engine.run('manual');
    expect(ok.problem ?? null).toBeNull();
    expect(ok.backoffMs ?? null).toBeNull();
    relay.before = () => new Response('{"error":"x"}', { status: 500 });
    expect((await a.engine.run('manual')).backoffMs).toBe(30_000); // success reset the ladder
  });
});

describe('engine: push only, stuck inbox', () => {
  it('pushOnly pushes pending batches and makes no GET batches request (FR-025)', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    addBook(b, 'Captured');
    relay.log.length = 0;
    const r = await b.engine.run('write', { pushOnly: true });
    expect(r.pushed).toBeGreaterThan(0);
    expect(r.changed).toBe(false);
    expect(gets(relay)).toBe(0);
    expect(posts(relay)).toBe(1);
    await a.engine.run('manual');
    expect(titles(a)).toEqual(['Captured']);
  });

  it('inboxStuck counts inbox rows that survived one full pull', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    const orphan = {
      op: uuid(0xc00001),
      hlc: `${String(Date.UTC(2026, 8, 27, 13, 0, 0)).padStart(13, '0')}-0000-${uuid(0xfeed)}`,
      tbl: 'reading_events',
      row: uuid(0xc00002),
      fields: { item_id: uuid(0xdead), event_type: 'started', occurred_at: '2026-09-01T10:00:00.000Z', local_date: '2026-09-01' },
    };
    await postRaw(relay, a, { v: 1, device: uuid(0xfeed), ops: [orphan] });
    await b.engine.run('visible');
    expect(b.db.raw.selectValue('SELECT COUNT(*) FROM sync_inbox')).toBe(1);
    expect(b.engine.status().inboxStuck).toBe(0); // it arrived in this very pull
    await b.engine.run('visible');
    expect(b.engine.status().inboxStuck).toBe(1); // a whole pull later, its item still never came
  });
});

describe('engine: status', () => {
  it('a successful run reports lastOkAt', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    expect(a.engine.status().lastOkAt).toMatch(/Z$/);
  });
});

describe('engine: turnOn / join errors (US1)', () => {
  const unknownCode = async () => {
    const { formatSyncCode } = await import('../src/code.ts');
    return formatSyncCode(Uint8Array.from({ length: 32 }, (_, i) => i + 7));
  };

  it('format: garbage is rejected locally, with no request and no local change', async () => {
    const relay = fakeRelay();
    const b = makePeer(2, relay);
    const r = await b.engine.join('not a code');
    expect(r).toMatchObject({ ok: false, error: { kind: 'format' } });
    expect(relay.log).toEqual([]);
    expect(b.engine.status().on).toBe(false);
  });

  it('checksum: one changed character is rejected locally, with no request and no local change', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const code = a.engine.showCode()!.code;
    const typo = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    const b = makePeer(2, relay);
    relay.log.length = 0;
    expect(await b.engine.join(typo)).toMatchObject({ ok: false, error: { kind: 'checksum' } });
    expect(relay.log).toEqual([]);
    expect(b.engine.status().on).toBe(false);
  });

  it('notFound: a valid code for an unknown space (404) changes nothing locally', async () => {
    const relay = fakeRelay();
    const b = makePeer(2, relay);
    addBook(b, 'Mine');
    const before = b.db.pendingCount();
    expect(await b.engine.join(await unknownCode())).toMatchObject({ ok: false, error: { kind: 'notFound' } });
    expect(b.engine.status().on).toBe(false);
    expect(b.engine.showCode()).toBeNull();
    expect(b.db.pendingCount()).toBe(before);
    expect(titles(b)).toEqual(['Mine']);
  });

  it('offline: join and turnOn report offline and change nothing', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const code = a.engine.showCode()!.code;
    const b = makePeer(2, relay);
    b.online = false;
    expect(await b.engine.join(code)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(await b.engine.turnOn()).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(b.engine.status().on).toBe(false);
    b.online = true;
    relay.before = () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await b.engine.join(code)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(b.engine.status().on).toBe(false);
  });

  it('relay: a 5xx on join or turnOn reports relay with its status and changes nothing', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const code = a.engine.showCode()!.code;
    const b = makePeer(2, relay);
    relay.before = () => new Response('{"error":"x"}', { status: 503 });
    expect(await b.engine.join(code)).toMatchObject({ ok: false, error: { kind: 'relay', status: 503 } });
    expect(await b.engine.turnOn()).toMatchObject({ ok: false, error: { kind: 'relay', status: 503 } });
    expect(b.engine.status().on).toBe(false);
  });

  it('no error text carries the code', async () => {
    const relay = fakeRelay();
    const b = makePeer(2, relay);
    const code = await unknownCode();
    const r = await b.engine.join(code);
    expect(JSON.stringify(r)).not.toContain(code.replace(/-/g, '').slice(0, 8));
  });

  it('join returns duplicates: 0 and pulls the host books; showCode matches turnOn', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    addBook(a, 'Dune');
    const on = await a.engine.turnOn();
    expect(on.ok && on.value.code).toBe(a.engine.showCode()!.code);
    const b = makePeer(2, relay);
    const r = await b.engine.join(a.engine.showCode()!.code);
    expect(r).toMatchObject({ ok: true, value: { duplicates: 0 } });
    expect(titles(b)).toEqual(['Dune']);
  });

  it('join returns the number of duplicate pairs after the merge of both logs (US5)', async () => {
    const relay = fakeRelay();
    const a = makePeer(1, relay);
    const b = makePeer(2, relay);
    for (const [p, n] of [[a, 0x610001], [b, 0x610002]] as const) {
      p.tick();
      expect(p.db.dispatch({ kind: 'AddBook', itemId: uuid(n), title: 'Dune', isbn: '9780306406157', startNow: false, localDate: '2026-09-01' }, p.env).ok).toBe(true);
    }
    await a.engine.turnOn();
    const r = await b.engine.join(a.engine.showCode()!.code);
    expect(r).toMatchObject({ ok: true, value: { duplicates: 1 } });
  });
});

describe('engine: leave and reset (US4)', () => {
  const metaKeys = (p: Peer) =>
    p.db.raw.selectValues(`SELECT key FROM meta WHERE key IN ('sync_key','sync_cursor','pending_batch','sync_status')`).map(String).sort();

  it('leave() removes the sync meta and keeps every row; the device stops calling the relay', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    addBook(a, 'Dune');
    await a.engine.run('write');
    expect(metaKeys(a)).toContain('sync_key');
    const changes = a.db.raw.selectValue('SELECT COUNT(*) FROM change_log');
    a.engine.leave();
    expect(metaKeys(a)).toEqual([]);
    expect(a.engine.status()).toMatchObject({ on: false, lastOkAt: null, problem: null });
    expect(titles(a)).toEqual(['Dune']);
    expect(a.db.raw.selectValue('SELECT COUNT(*) FROM change_log')).toBe(changes);
    relay.log.length = 0;
    await a.engine.run('manual');
    expect(relay.log).toEqual([]);
  });

  it('reset() makes a new space with every change_log row, then deletes the old one', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    addBook(a, 'Dune');
    addBook(b, 'Emma');
    await b.engine.run('write');
    await a.engine.run('visible'); // a now holds a received row too
    const oldCode = a.engine.showCode()!.code;
    relay.log.length = 0;
    const r = await a.engine.reset();
    expect(r.ok).toBe(true);
    const newCode = a.engine.showCode()!.code;
    expect(newCode).not.toBe(oldCode);
    expect(r.ok && r.value.code).toBe(newCode);
    // Order: create, push, then delete.
    const kinds = relay.log.map((x) => x.method);
    expect(kinds[0]).toBe('PUT');
    expect(kinds.lastIndexOf('POST')).toBeLessThan(kinds.indexOf('DELETE'));
    expect(a.db.syncMeta().oldSpace).toBeNull();
    expect(a.db.pendingCount()).toBe(0);
    // A third device joining with the new code gets the union.
    const c = await joinSpace(relay, a, 3);
    expect(titles(c).sort()).toEqual(['Dune', 'Emma']);
  });

  it('a failed DELETE keeps sync_old_space and the next run() retries it', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    relay.before = (req) => (req.method === 'DELETE' ? new Response('{"error":"x"}', { status: 503 }) : undefined);
    const r = await a.engine.reset();
    expect(r.ok).toBe(true);
    expect(a.db.syncMeta().oldSpace).not.toBeNull();
    relay.before = undefined;
    relay.log.length = 0;
    await a.engine.run('manual');
    expect(relay.log.some((x) => x.method === 'DELETE')).toBe(true);
    expect(a.db.syncMeta().oldSpace).toBeNull();
    relay.log.length = 0;
    await a.engine.run('manual');
    expect(relay.log.some((x) => x.method === 'DELETE')).toBe(false);
  });

  it('a peer on the old space gets spaceGone; rejoining with the new code merges its local-only data', async () => {
    const relay = fakeRelay();
    const a = await startSpace(relay);
    const b = await joinSpace(relay, a, 2);
    addBook(a, 'Dune');
    await a.engine.run('write');
    await b.engine.run('visible');
    addBook(b, 'Emma'); // local only: b never pushes it to the old space
    await a.engine.reset();
    const gone = await b.engine.run('manual');
    expect(gone.problem).toBe('spaceGone');
    expect(titles(b).sort()).toEqual(['Dune', 'Emma']);
    // The old space really is gone: the old code no longer joins.
    const stale = makePeer(9, relay);
    expect(await stale.engine.join(b.engine.showCode()!.code)).toMatchObject({ ok: false, error: { kind: 'notFound' } });

    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    expect(b.engine.status().problem).toBeNull();
    await a.engine.run('visible');
    expect(titles(a).sort()).toEqual(['Dune', 'Emma']);
    expect(titles(b).sort()).toEqual(['Dune', 'Emma']);
  });
});
