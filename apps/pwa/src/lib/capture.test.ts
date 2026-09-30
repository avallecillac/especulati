import { describe, expect, it } from 'vitest';
import { captureId, decodeCapture } from './capture.ts';

const std = (o: unknown): string => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const AT = '2026-03-04T12:00:00Z';
const base = { v: 1, url: 'https://www.example.com/a?utm_source=x', title: 'A title', author: 'Ann', words: 2380, at: AT };

/** What Shortcuts does: Base64 (with line breaks every 76 chars), then URL-encode. */
const shortcut = (o: unknown): string => encodeURIComponent(std(o).replace(/(.{76})/g, '$1\n'));

const value = (d: string) => {
  const r = decodeCapture(d);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.reason}`);
  return r.value;
};

describe('decodeCapture', () => {
  it('accepts standard Base64 with +/, padding and line breaks, URL-encoded', () => {
    const o = { ...base, title: 'Ñandú ??>>~~ ☃ '.repeat(12) };
    const b64 = std(o);
    expect(b64).toMatch(/[+/]/);
    const c = value(shortcut(o));
    expect(c.title).toBe(o.title.trim());
    expect(c.url).toBe('https://www.example.com/a');
    expect(c.site).toBe('example.com');
    expect(c.author).toBe('Ann');
    expect(c.wordCount).toBe(2380);
    expect(c.at).toBe('2026-03-04T12:00:00.000Z');
  });

  it('accepts unencoded standard Base64 too', () => {
    expect(value(std(base)).title).toBe('A title');
  });

  it('accepts base64url', () => {
    const o = { ...base, title: '>>??~~ ñ ☃'.repeat(10) };
    const url = std(o).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(url).toMatch(/[-_]/);
    expect(value(url).title).toBe(o.title.trim());
  });

  it('converts an offset time to a UTC instant', () => {
    expect(value(std({ ...base, at: '2026-03-04T20:30:00-05:00' })).at).toBe('2026-03-05T01:30:00.000Z');
  });

  it('words: numeric string parsed; 0, negatives, too big and junk become null', () => {
    expect(value(std({ ...base, words: '1234' })).wordCount).toBe(1234);
    for (const words of [0, '0', -3, 100001, 'abc', 1.5, null, undefined]) {
      expect(value(std({ ...base, words })).wordCount).toBeNull();
    }
    expect(value(std({ ...base, words: 100000 })).wordCount).toBe(100000);
  });

  it('a missing or bad url, or a missing or bad at, is an error', () => {
    const noUrl = { ...base, url: undefined };
    const noAt = { ...base, at: undefined };
    for (const o of [noUrl, { ...base, url: 'not a url' }, { ...base, url: 'ftp://x.com/a' }, noAt, { ...base, at: 'yesterday' }, { ...base, at: 12 }]) {
      expect(decodeCapture(std(o)).ok).toBe(false);
    }
  });

  it('v: 2, a missing v, bad Base64 and bad JSON are errors', () => {
    expect(decodeCapture(std({ ...base, v: 2 })).ok).toBe(false);
    expect(decodeCapture(std({ ...base, v: undefined })).ok).toBe(false);
    expect(decodeCapture('%%%not base64').ok).toBe(false);
    expect(decodeCapture(Buffer.from('{nope', 'utf8').toString('base64')).ok).toBe(false);
    expect(decodeCapture(Buffer.from('[1]', 'utf8').toString('base64')).ok).toBe(false);
    expect(decodeCapture('').ok).toBe(false);
  });

  it('says which field is wrong, so the Shortcut can be fixed', () => {
    const reason = (d: string) => {
      const r = decodeCapture(d);
      if (r.ok) throw new Error('expected an error');
      return r.error.reason;
    };
    expect(reason(std({ ...base, at: '2026-09-30' }))).toBe('at');
    expect(reason(std({ ...base, url: 'not a url' }))).toBe('url');
    expect(reason(std({ ...base, v: '1' }))).toBe('v');
    expect(reason('%%%not base64')).toBe('encoding');
    expect(reason(Buffer.from('{nope', 'utf8').toString('base64'))).toBe('encoding');
  });

  it('trims the title and cuts it to 500 characters; an empty title falls back to the site', () => {
    expect(value(std({ ...base, title: '  Hello  ' })).title).toBe('Hello');
    expect(value(std({ ...base, title: 'x'.repeat(600) })).title).toHaveLength(500);
    expect(value(std({ ...base, title: '   ' })).title).toBe('example.com');
    expect(value(std({ ...base, title: undefined })).title).toBe('example.com');
  });

  it('cuts the author to 200 characters; a blank author is null', () => {
    expect(value(std({ ...base, author: 'a'.repeat(300) })).author).toHaveLength(200);
    expect(value(std({ ...base, author: '  ' })).author).toBeNull();
    expect(value(std({ ...base, author: undefined })).author).toBeNull();
  });
});

describe('captureId', () => {
  it('is deterministic for the same normalized url and instant, and differs for another instant', async () => {
    const a = value(std(base));
    const b = value(std({ ...base, url: 'HTTPS://www.example.com/a?fbclid=1#top' }));
    expect(await captureId(a)).toBe(await captureId(b));
    expect(await captureId(a)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await captureId(value(std({ ...base, at: '2026-03-04T12:00:01Z' })))).not.toBe(await captureId(a));
  });
});
