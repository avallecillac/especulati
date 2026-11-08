import { describe, expect, it } from 'vitest';
import { tagKey, tagName, TAG_NAME_MAX, TAGS_PER_ARTICLE_MAX, tierOf } from '../src/index.ts';

describe('tagKey', () => {
  it('applies NFKC, trims, collapses spaces and lower-cases', () => {
    expect(tagKey('  AI  ')).toBe('ai');
    expect(tagKey('Machine   Learning')).toBe('machine learning');
    expect(tagKey('ＡＩ')).toBe('ai'); // full-width, NFKC
    expect(tagKey('a\t\nb')).toBe('a b');
  });
  it('gives null for an empty name', () => {
    expect(tagKey('')).toBeNull();
    expect(tagKey('   ')).toBeNull();
  });
  it('treats AI and " ai " as the same key', () => {
    expect(tagKey('AI')).toBe(tagKey(' ai '));
  });
});

describe('tagName', () => {
  it('trims and keeps case', () => {
    expect(tagName('  AI  ')).toEqual({ ok: true, value: 'AI' });
  });
  it('rejects empty and over-long names', () => {
    expect(tagName('   ').ok).toBe(false);
    expect(tagName('x'.repeat(TAG_NAME_MAX)).ok).toBe(true);
    const long = tagName('x'.repeat(TAG_NAME_MAX + 1));
    expect(long).toEqual({ ok: false, error: { field: 'name', reason: expect.any(String) } });
  });
  it('rejects a name whose normalised key would exceed 40 characters', () => {
    expect(tagName('ﬃ'.repeat(20)).ok).toBe(false); // 20 chars, key is 60
  });
  it('exports the limits', () => {
    expect(TAG_NAME_MAX).toBe(40);
    expect(TAGS_PER_ARTICLE_MAX).toBe(20);
  });
});

describe('tierOf(tbl, fields)', () => {
  it('highlights are h', () => expect(tierOf('highlights', { quote: 'x' })).toBe('h'));
  it('tags and item_tags are t', () => {
    expect(tierOf('tags', { name: 'ai' })).toBe('t');
    expect(tierOf('item_tags', { deleted_at: 'x' })).toBe('t');
  });
  it('an items op with read_on null is s', () => {
    expect(tierOf('items', { read_on: null })).toBe('s');
    expect(tierOf('items', { type: 'article', read_on: null })).toBe('s');
  });
  it('an items op with a date or without read_on is base', () => {
    expect(tierOf('items', { read_on: '2026-09-01' })).toBe('base');
    expect(tierOf('items', { title: 'x' })).toBe('base');
    expect(tierOf('items', { title: null })).toBe('base');
  });
  it('reading_events is base, even with a null read_on-like field', () => {
    expect(tierOf('reading_events', { page: null })).toBe('base');
    expect(tierOf('duplicate_dismissals', {})).toBe('base');
  });
});
