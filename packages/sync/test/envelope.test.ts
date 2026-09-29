import { describe, expect, it } from 'vitest';
import { deriveKeys } from '../src/keys.ts';
import { open, seal, type Plain } from '../src/envelope.ts';

const k = Uint8Array.from({ length: 32 }, (_, i) => i);
const plain: Plain = {
  v: 1,
  device: 'dev-1',
  ops: [{ op: 'o1', hlc: '0000000000001-0000-dev-1', tbl: 'items', row: 'r1', fields: { title: 'Dune', n: 3, x: null } }],
};
const b64u = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setup() {
  return deriveKeys(k);
}

/** Encrypt an arbitrary plaintext with the given flag byte, as a foreign sender would. */
async function rawSeal(flag: number, body: Uint8Array, key: CryptoKey, spaceId: string, batchId: string) {
  const iv = new Uint8Array(12).fill(5);
  const pt = new Uint8Array(body.length + 1);
  pt[0] = flag;
  pt.set(body, 1);
  const aad = new TextEncoder().encode(`readerlog/v1/${spaceId}/${batchId}`);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, pt));
  return { batchId, iv: Buffer.from(iv).toString('base64url'), ct: Buffer.from(ct).toString('base64url') };
}

describe('envelope', () => {
  it('round-trips', async () => {
    const { encKey, spaceId } = await setup();
    const e = await seal(plain, encKey, spaceId, 'b1');
    expect(e.batchId).toBe('b1');
    expect(await open(e, encKey, spaceId)).toEqual({ ok: true, value: plain });
  });

  it('uses a fresh IV each time (12 bytes)', async () => {
    const { encKey, spaceId } = await setup();
    const a = await seal(plain, encKey, spaceId, 'b1');
    const b = await seal(plain, encKey, spaceId, 'b1');
    expect(Buffer.from(a.iv, 'base64url')).toHaveLength(12);
    expect(a.iv).not.toBe(b.iv);
  });

  it('compresses large repetitive plaintext', async () => {
    const { encKey, spaceId } = await setup();
    const big: Plain = { ...plain, ops: Array.from({ length: 200 }, () => plain.ops[0]!) };
    const e = await seal(big, encKey, spaceId, 'b1');
    expect(Buffer.from(e.ct, 'base64url').length).toBeLessThan(JSON.stringify(big).length / 4);
    expect(await open(e, encKey, spaceId)).toEqual({ ok: true, value: big });
  });

  it("tampered ct, iv, batchId or different spaceId give 'decrypt'", async () => {
    const { encKey, spaceId } = await setup();
    const e = await seal(plain, encKey, spaceId, 'b1');
    const ct = Buffer.from(e.ct, 'base64url');
    ct[ct.length - 1]! ^= 1;
    const iv = Buffer.from(e.iv, 'base64url');
    iv[0]! ^= 1;
    expect(await open({ ...e, ct: ct.toString('base64url') }, encKey, spaceId)).toEqual({ ok: false, error: 'decrypt' });
    expect(await open({ ...e, iv: iv.toString('base64url') }, encKey, spaceId)).toEqual({ ok: false, error: 'decrypt' });
    expect(await open({ ...e, batchId: 'b2' }, encKey, spaceId)).toEqual({ ok: false, error: 'decrypt' });
    expect(await open(e, encKey, 'f'.repeat(32))).toEqual({ ok: false, error: 'decrypt' });
    expect(await open({ ...e, ct: '!!!' }, encKey, spaceId)).toEqual({ ok: false, error: 'decrypt' });
  });

  it("v:2 gives 'version'", async () => {
    const { encKey, spaceId } = await setup();
    const e = await seal({ ...plain, v: 2 } as unknown as Plain, encKey, spaceId, 'b1');
    expect(await open(e, encKey, spaceId)).toEqual({ ok: false, error: 'version' });
  });

  it("garbage plaintext gives 'shape'", async () => {
    const { encKey, spaceId } = await setup();
    const enc = new TextEncoder();
    for (const body of ['not json', '{"v":1}', '{"v":1,"device":"d","ops":"x"}']) {
      const e = await rawSeal(0, enc.encode(body), encKey, spaceId, 'b1');
      expect(await open(e, encKey, spaceId)).toEqual({ ok: false, error: 'shape' });
    }
  });

  it('raw flag path works', async () => {
    const { encKey, spaceId } = await setup();
    const e = await rawSeal(0, new TextEncoder().encode(JSON.stringify(plain)), encKey, spaceId, 'b1');
    expect(await open(e, encKey, spaceId)).toEqual({ ok: true, value: plain });
  });

  it('seals raw (flag 0) when CompressionStream is unavailable', async () => {
    const { encKey, spaceId } = await setup();
    const orig = globalThis.CompressionStream;
    // @ts-expect-error simulate an old browser
    globalThis.CompressionStream = undefined;
    try {
      const e = await seal(plain, encKey, spaceId, 'b1');
      const aad = new TextEncoder().encode(`readerlog/v1/${spaceId}/b1`);
      const pt = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: Buffer.from(e.iv, 'base64url'), additionalData: aad },
          encKey,
          Buffer.from(e.ct, 'base64url'),
        ),
      );
      expect(pt[0]).toBe(0);
      globalThis.CompressionStream = orig;
      expect(await open(e, encKey, spaceId)).toEqual({ ok: true, value: plain });
    } finally {
      globalThis.CompressionStream = orig;
    }
  });

  it('ciphertext hides plaintext ("Dune" and its base64)', async () => {
    const { encKey, spaceId } = await setup();
    const e = await seal(plain, encKey, spaceId, 'b1');
    const wire = JSON.stringify(e);
    for (const s of ['Dune', b64('Dune'), b64u('Dune')]) expect(wire).not.toContain(s);
    const raw = Buffer.from(e.ct, 'base64url');
    expect(raw.includes(Buffer.from('Dune'))).toBe(false);
    // also with the raw path
    const r = await rawSeal(0, new TextEncoder().encode(JSON.stringify(plain)), encKey, spaceId, 'b1');
    expect(Buffer.from(r.ct, 'base64url').includes(Buffer.from('Dune'))).toBe(false);
  });
});
