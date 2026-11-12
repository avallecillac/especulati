// 4.3: the sync code, keys, auth token and the TMDB key never appear in errors, logs or exports.
// Distinctive values make a substring scan free of false positives.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instant } from '@especulati/cinefilo-core';
import { deriveKeys, parseSyncCode } from '@especulati/sync';
import { cinefiloSyncApp } from '../src/index.ts';
import { addManual, ANA, BEN, rate, seedMembers } from './helpers.ts';
import { fakeRelay, makePeer, untilQuiet } from './harness.ts';

const TMDB_KEY = 'TMDB-KEY-DISTINCTIVE-eyJhbGciOiJIUzI1NiJ9-0042';
const TITLE = 'Zanzibar Quokka Chronicle';

afterEach(() => vi.restoreAllMocks());

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

describe('redaction (4.3)', () => {
  it('forced errors, logs and exports never contain the code, keys, token or TMDB key', async () => {
    const logged: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(' ')));
    }
    const outputs: string[] = [];
    const seen = (x: unknown) => void outputs.push(x instanceof Error ? `${x.name}: ${x.message}\n${x.stack ?? ''}` : JSON.stringify(x));

    const relay = fakeRelay();
    const a = makePeer(1, relay, ANA);
    seedMembers(a, ANA);
    a.db.setMeta('tmdb_key', TMDB_KEY);
    expect((await a.engine.turnOn()).ok).toBe(true);
    const code = a.engine.showCode()!.code;
    const secret = (() => { const k = parseSyncCode(code); if (!k.ok) throw new Error('code'); return k.value; })();
    const keys = await deriveKeys(secret, cinefiloSyncApp.salt);
    const secrets = [code, a.engine.showCode()!.qr, b64(secret), Buffer.from(secret).toString('hex'), Buffer.from(secret).toString('base64url'), keys.authToken, TMDB_KEY];

    const film = addManual(a, TITLE, { year: 2001 });
    rate(a, film, 9, 'review text');

    // Errors from every failure mode a user (or the network) can cause.
    const b = makePeer(2, relay, BEN);
    expect((await b.engine.join(code)).ok).toBe(true);
    await untilQuiet([a, b]);
    const c = makePeer(3, relay, null);
    seen(await c.engine.join('not a code'));
    seen(await c.engine.join(`${code.slice(0, -3)}xxx`)); // checksum
    seen(await c.engine.join('cinefilo:sync:1:' + 'A'.repeat(40)));
    for (const mode of ['network', 'http500', 'http401'] as const) { // 401 ends sync until the user rejoins
      relay.before = () => {
        if (mode === 'network') throw new Error(`connect failed with ${keys.authToken}`);
        return new Response('{}', { status: mode === 'http500' ? 500 : 401 });
      };
      a.tick(1000);
      seen(await a.engine.run('manual'));
      seen(a.engine.status());
    }
    relay.before = undefined;
    // A rejected command, a failed import and a failed page apply.
    seen(a.db.dispatch({ kind: 'SetStars', titleId: film, memberId: BEN, ratingId: ANA, stars: 9 }, a.env));
    seen(a.db.import(`{"format":"cinefilo/v1","x":"${TMDB_KEY}"}`, a.env));
    seen(a.db.import(TMDB_KEY, a.env));
    try {
      a.db.syncStore.applyPulledPage([{ opId: 'bad', hlc: 'x', deviceId: 'y', tbl: 'titles', rowId: 'z', fields: { status: 'bogus' } } as never], 1, () => 0);
    } catch (e) {
      seen(e);
    }
    // The device's own state is full of secrets (meta holds sync_key and tmdb_key) but none of it is exported.
    expect(a.db.getMeta('tmdb_key')).toBe(TMDB_KEY);
    expect(a.db.syncStore.syncMeta().key).not.toBeNull();
    outputs.push(a.db.exportText('2026-09-27T12:00:00.000Z' as Instant));
    outputs.push(JSON.stringify(a.db.exportData('2026-09-27T12:00:00.000Z' as Instant)));
    outputs.push(JSON.stringify(await relay.store.listBatches(keys.spaceId, 0, 1000)), JSON.stringify(relay.log));

    const haystack = [...outputs, ...logged].join('\n');
    expect(haystack.length).toBeGreaterThan(200);
    for (const s of secrets) expect(haystack, `leaked ${s.slice(0, 12)}…`).not.toContain(s);
    // Plaintext domain data is also absent from everything the relay saw.
    expect(outputs.slice(-2).join('\n')).not.toContain(TITLE);
    expect(logged).toEqual([]);
    for (const p of [a, b, c]) p.close();
  });
});
