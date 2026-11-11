import { describe, expect, it } from 'vitest';
import { normalizeUrl, siteOf, type NormalizedUrl } from '../src/index.ts';

const norm = (s: string): string => {
  const r = normalizeUrl(s);
  if (!r.ok) throw new Error(`expected ok for ${s}: ${r.error.reason}`);
  return r.value;
};

describe('normalizeUrl', () => {
  it.each([
    ['HTTPS://WWW.Example.com:443/a?utm_source=x&b=1#top', 'https://www.example.com/a?b=1'],
    ['http://example.com/?fbclid=1&gclid=2', 'http://example.com/'],
    ['https://example.com/p?ref=hn&id=7', 'https://example.com/p?id=7'],
    ['https://blog.example.com/x?si=abc', 'https://blog.example.com/x'],
  ])('%s -> %s', (input, output) => expect(norm(input)).toBe(output));

  it.each(['ftp://example.com/x', 'not a url', '', 'https://', 'https:///path', 'javascript:alert(1)', 'https://exa mple.com/'])(
    'rejects %j with InvalidUrl',
    (input) => expect(normalizeUrl(input)).toEqual({ ok: false, error: { field: 'url', reason: expect.any(String) } }),
  );

  it('does not support IPv6 hosts', () => {
    expect(normalizeUrl('http://[::1]/x').ok).toBe(false);
    expect(normalizeUrl('http://[2001:db8::1]:8080/').ok).toBe(false);
  });

  it('drops a "?" left with no parameters, and keeps the order of the rest', () => {
    expect(norm('https://e.com/a?utm_medium=x')).toBe('https://e.com/a');
    expect(norm('https://e.com/a?')).toBe('https://e.com/a');
    expect(norm('https://e.com/a?z=1&a=2&utm_campaign=q&m=3')).toBe('https://e.com/a?z=1&a=2&m=3');
  });

  it('removes every tracking parameter, case-insensitively for names', () => {
    for (const p of ['utm_term', 'UTM_Source', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'igshid', 'si'])
      expect(norm(`https://e.com/a?${p}=1&keep=2`)).toBe('https://e.com/a?keep=2');
    expect(norm('https://e.com/a?reference=1&sig=2')).toBe('https://e.com/a?reference=1&sig=2');
  });

  it('keeps a percent-encoded path as is', () => {
    expect(norm('https://e.com/caf%C3%A9/a%20b?q=%E2%9C%93')).toBe('https://e.com/caf%C3%A9/a%20b?q=%E2%9C%93');
  });

  it('drops default ports only', () => {
    expect(norm('http://e.com:80/a')).toBe('http://e.com/a');
    expect(norm('https://e.com:443')).toBe('https://e.com/');
    expect(norm('https://e.com:80/a')).toBe('https://e.com:80/a');
    expect(norm('http://e.com:8080/a')).toBe('http://e.com:8080/a');
  });

  it('adds "/" for an empty path and drops the fragment', () => {
    expect(norm('https://Example.COM')).toBe('https://example.com/');
    expect(norm('https://e.com/a#x?y=1')).toBe('https://e.com/a');
  });

  it('is idempotent', () => {
    const once = norm('HTTPS://WWW.Example.com:443/a?utm_source=x&b=1#top');
    expect(norm(once)).toBe(once);
  });

  it('trims surrounding whitespace', () => expect(norm('  https://e.com/a \n')).toBe('https://e.com/a'));
});

describe('siteOf', () => {
  const site = (s: string) => siteOf(norm(s) as NormalizedUrl);
  it('strips only a leading www.', () => {
    expect(site('https://www.example.com/a')).toBe('example.com');
    expect(site('https://blog.example.com/a')).toBe('blog.example.com');
    expect(site('https://example.com/www.x')).toBe('example.com');
    expect(site('https://awww.example.com/')).toBe('awww.example.com');
    expect(site('https://www.www.example.com/')).toBe('www.example.com');
  });
  it('excludes a port', () => expect(site('http://www.e.com:8080/a')).toBe('e.com'));
});
