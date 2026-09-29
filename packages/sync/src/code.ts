import { err, ok, type Result } from '@readerlog/core';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const QR_PREFIX = 'readerlog:sync:1:';
const CHECK_BYTES = 3;
const SECRET_BYTES = 32;
const CODE_CHARS = ((SECRET_BYTES + CHECK_BYTES) * 8) / 5; // 56

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

/** Synchronous SHA-256 (WebCrypto's is async; the code helpers are sync). */
function sha256(data: Uint8Array): Uint8Array {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6));
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  dv.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [
      number, number, number, number, number, number, number, number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const s = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + s[i]!) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]!);
  return out;
}

export function newSyncSecret(random: (n: number) => Uint8Array): Uint8Array {
  return random(SECRET_BYTES).slice(0, SECRET_BYTES);
}

function encode32(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out; // 35 bytes = 280 bits: no leftover bits
}

function decode32(chars: string): Uint8Array {
  const out = new Uint8Array((chars.length * 5) >> 3);
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of chars) {
    acc = (acc << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[n++] = (acc >> (bits - 8)) & 255;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

function flat(k: Uint8Array): string {
  const bytes = new Uint8Array(SECRET_BYTES + CHECK_BYTES);
  bytes.set(k);
  bytes.set(sha256(k).subarray(0, CHECK_BYTES), SECRET_BYTES);
  return encode32(bytes);
}

export function formatSyncCode(k: Uint8Array): string {
  return flat(k).match(/.{4}/g)!.join('-');
}

export function parseSyncCode(s: string): Result<Uint8Array, 'format' | 'checksum'> {
  const norm = s
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (norm.length !== CODE_CHARS) return err('format');
  for (const ch of norm) if (!ALPHABET.includes(ch)) return err('format');
  const bytes = decode32(norm);
  const k = bytes.slice(0, SECRET_BYTES);
  const check = sha256(k).subarray(0, CHECK_BYTES);
  for (let i = 0; i < CHECK_BYTES; i++) if (bytes[SECRET_BYTES + i] !== check[i]) return err('checksum');
  return ok(k);
}

export function qrPayload(k: Uint8Array): string {
  return QR_PREFIX + flat(k);
}

export function parseQrPayload(s: string): Result<Uint8Array, 'format' | 'checksum'> {
  const t = s.trim();
  if (!t.startsWith(QR_PREFIX)) return err('format');
  return parseSyncCode(t.slice(QR_PREFIX.length));
}
