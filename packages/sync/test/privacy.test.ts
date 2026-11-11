// Privacy audit for the generic engine: the relay holds only ciphertext, and what the ciphertext
// holds is only the app's synced tables. Distinctive seed values make a substring scan free of
// false positives. (The lector-specific audit lives in packages/lector-sync.)
import { describe, expect, it } from 'vitest';
import { parseSyncCode } from '../src/code.ts';
import { open } from '../src/envelope.ts';
import { deriveKeys } from '../src/keys.ts';
import { fakeRelay, makeToyPeer, toyApp } from './toyHarness.ts';

const BODY = 'Zanzibar Quokka Chronicle';
const LABEL = 'Ophelia Wurtzelbacher';
const LOCAL_ONLY = 'LOCAL-ONLY-MARKER-8675309';

const utf8 = (s: string) => new TextEncoder().encode(s);
/** Every way `needle` can appear in base64 / base64url text, whatever its byte alignment. */
function encodings(needle: string): string[] {
  const out = [needle];
  for (let pad = 0; pad < 3; pad++) {
    const full = Buffer.from(utf8('x'.repeat(pad) + needle)).toString('base64');
    const stable = full.slice(Math.ceil((pad * 4) / 3), -2).replace(/=+$/, '');
    if (stable.length >= 8) out.push(stable, stable.replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return out;
}

describe('privacy audit (generic engine)', () => {
  it('the relay stores no plaintext, and pushed batches carry only the synced tables', async () => {
    const relay = fakeRelay();
    const a = makeToyPeer(1, relay);
    a.raw.exec("INSERT INTO meta (key, value) VALUES ('device_note', ?)", { bind: [LOCAL_ONLY] });
    expect((await a.engine.turnOn()).ok).toBe(true);
    const note = a.addNote(BODY);
    a.addMark(note, LABEL);
    await a.engine.run('write');
    const b = makeToyPeer(2, relay);
    expect((await b.engine.join(a.engine.showCode()!.code)).ok).toBe(true);
    b.addNote('Second distinct note');
    await b.engine.run('write');
    await a.engine.run('visible');

    const k = parseSyncCode(a.engine.showCode()!.code);
    if (!k.ok) throw new Error('code');
    const keys = await deriveKeys(k.value, toyApp.salt);
    const batches = await relay.store.listBatches(keys.spaceId, 0, 1000);
    expect(batches.length).toBeGreaterThan(1);
    const plains = [];
    for (const env of batches) {
      const r = await open(env, keys.encKey, keys.spaceId, toyApp.aadPrefix);
      expect(r.ok).toBe(true);
      if (r.ok) plains.push(r.value);
    }
    const ops = plains.flatMap((p) => p.ops);
    expect(ops.length).toBeGreaterThan(2);

    const dump = relay.store.dumpAll();
    expect(dump.length).toBeGreaterThan(0);
    const needles = [BODY, LABEL, LOCAL_ONLY, 'body', 'label', 'op_id', 'device', a.device, b.device, ...ops.flatMap((o) => [o.op, o.row])];
    for (const needle of needles) {
      for (const form of encodings(needle)) {
        if (form.length < 4) continue;
        expect(dump.includes(form), `relay dump must not contain ${JSON.stringify(needle)} as ${JSON.stringify(form)}`).toBe(false);
      }
    }

    expect(new Set(ops.map((o) => o.tbl))).toEqual(new Set(['notes', 'marks']));
    const text = JSON.stringify(plains);
    for (const banned of ['"tbl":"meta"', 'device_note', 'sync_key', LOCAL_ONLY]) {
      expect(text.includes(banned), `decrypted batches must not contain ${banned}`).toBe(false);
    }
    expect(text).toContain(BODY);
  });
});
