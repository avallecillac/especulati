import { err, ok, type OpWire, type Result } from '@especulati/lector-core';
import { ENVELOPE_AAD_PREFIX } from './frozen.ts';

export type { OpWire };
export interface Plain {
  v: 1;
  device: string;
  ops: OpWire[];
}
export interface Envelope {
  batchId: string;
  iv: string;
  ct: string;
}

const FLAG_RAW = 0;
const FLAG_GZIP = 1;

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const aadFor = (spaceId: string, batchId: string) => new TextEncoder().encode(`${ENVELOPE_AAD_PREFIX}/${spaceId}/${batchId}`);

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function seal(p: Plain, key: CryptoKey, spaceId: string, batchId: string): Promise<Envelope> {
  const json = new TextEncoder().encode(JSON.stringify(p));
  let flag = FLAG_RAW;
  let body: Uint8Array = json;
  if (typeof CompressionStream !== 'undefined') {
    try {
      body = await pipe(json, new CompressionStream('gzip'));
      flag = FLAG_GZIP;
    } catch {
      body = json;
    }
  }
  const pt = new Uint8Array(body.length + 1);
  pt[0] = flag;
  pt.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(spaceId, batchId) }, key, pt),
  );
  return { batchId, iv: toB64url(iv), ct: toB64url(ct) };
}

export async function open(
  e: Envelope,
  key: CryptoKey,
  spaceId: string,
): Promise<Result<Plain, 'decrypt' | 'version' | 'shape'>> {
  const iv = fromB64url(e.iv);
  const ct = fromB64url(e.ct);
  if (!iv || !ct || iv.length !== 12) return err('decrypt');
  let pt: Uint8Array;
  try {
    pt = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aadFor(spaceId, e.batchId) }, key, ct.slice()),
    );
  } catch {
    return err('decrypt');
  }
  let json: Uint8Array = pt.subarray(1);
  if (pt[0] === FLAG_GZIP) {
    try {
      json = await pipe(json, new DecompressionStream('gzip'));
    } catch {
      return err('shape');
    }
  } else if (pt[0] !== FLAG_RAW) {
    return err('shape');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return err('shape');
  }
  if (typeof parsed !== 'object' || parsed === null) return err('shape');
  const o = parsed as Record<string, unknown>;
  if (typeof o.v === 'number' && o.v > 1) return err('version');
  if (o.v !== 1 || typeof o.device !== 'string' || !Array.isArray(o.ops)) return err('shape');
  return ok(parsed as Plain);
}
