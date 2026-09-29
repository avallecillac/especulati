import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatSyncCode, newSyncSecret, parseQrPayload, parseSyncCode, qrPayload } from '../src/code.ts';

const k = Uint8Array.from({ length: 32 }, (_, i) => i);
const fixedRandom = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff);

describe('sync code', () => {
  it('newSyncSecret returns 32 injected bytes', () => {
    const s = newSyncSecret(fixedRandom);
    expect(s).toHaveLength(32);
    expect(s[1]).toBe(10);
  });

  it('formats as 56 Crockford chars in 14 groups of 4', () => {
    const code = formatSyncCode(k);
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(code.replaceAll('-', '')).toHaveLength(56);
  });

  it('checksum is the first 3 bytes of SHA-256 (independent check)', () => {
    const digest = createHash('sha256').update(k).digest();
    const bytes = new Uint8Array(35);
    bytes.set(k);
    bytes.set(digest.subarray(0, 3), 32);
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let bits = 0n;
    for (const b of bytes) bits = (bits << 8n) | BigInt(b);
    let out = '';
    for (let i = 55; i >= 0; i--) out += alphabet[Number((bits >> BigInt(i * 5)) & 31n)];
    expect(formatSyncCode(k).replaceAll('-', '')).toBe(out);
  });

  it('round-trips', () => {
    const r = parseSyncCode(formatSyncCode(k));
    expect(r).toEqual({ ok: true, value: k });
  });

  it('is tolerant: lowercase, spaces, no hyphens', () => {
    const code = formatSyncCode(k);
    for (const v of [code.toLowerCase(), code.replaceAll('-', ' '), code.replaceAll('-', ''), ` ${code} `]) {
      expect(parseSyncCode(v)).toEqual({ ok: true, value: k });
    }
  });

  it('maps O->0 and I/L->1', () => {
    // find a secret whose code contains 0 and 1, then swap in the lookalikes
    const kk = Uint8Array.from({ length: 32 }, (_, i) => i);
    const code = formatSyncCode(kk);
    expect(code).toContain('0');
    expect(code).toContain('1');
    const swapped = code.replaceAll('0', 'O').replaceAll('1', 'I');
    expect(parseSyncCode(swapped)).toEqual({ ok: true, value: kk });
    expect(parseSyncCode(code.replaceAll('0', 'o').replaceAll('1', 'l'))).toEqual({ ok: true, value: kk });
  });

  it("rejects wrong lengths with 'format'", () => {
    const flat = formatSyncCode(k).replaceAll('-', '');
    expect(parseSyncCode(flat.slice(1))).toEqual({ ok: false, error: 'format' });
    expect(parseSyncCode(flat + '0')).toEqual({ ok: false, error: 'format' });
    expect(parseSyncCode('')).toEqual({ ok: false, error: 'format' });
    expect(parseSyncCode('U'.repeat(56))).toEqual({ ok: false, error: 'format' }); // U is not in the alphabet
  });

  it("rejects a flipped character with 'checksum'", () => {
    const flat = formatSyncCode(k).replaceAll('-', '');
    for (const i of [0, 20, 40, 55]) {
      const c = flat[i] === 'A' ? 'B' : 'A';
      const bad = flat.slice(0, i) + c + flat.slice(i + 1);
      expect(parseSyncCode(bad)).toEqual({ ok: false, error: 'checksum' });
    }
  });

  it('qrPayload round-trips and rejects other prefixes', () => {
    const q = qrPayload(k);
    expect(q.startsWith('readerlog:sync:1:')).toBe(true);
    expect(q.slice('readerlog:sync:1:'.length)).toHaveLength(56);
    expect(parseQrPayload(q)).toEqual({ ok: true, value: k });
    expect(parseQrPayload('readerlog:sync:2:' + formatSyncCode(k))).toEqual({ ok: false, error: 'format' });
    expect(parseQrPayload('https://x.test/' + formatSyncCode(k))).toEqual({ ok: false, error: 'format' });
    expect(parseQrPayload(formatSyncCode(k))).toEqual({ ok: false, error: 'format' });
  });
});
