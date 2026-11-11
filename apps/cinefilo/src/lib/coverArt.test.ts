import { describe, expect, it } from 'vitest';
import { COVER_TOKENS, HERO_BOX, THUMB_BOX, coverSpec, fnv1a } from './coverArt.ts';

const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe.each(['beton', 'willis'])('coverSpec: %s', (theme) => {
  it('is deterministic: the same id and theme give the same spec', () => {
    for (const id of ids) expect(coverSpec(id, theme, THUMB_BOX)).toEqual(coverSpec(id, theme, THUMB_BOX));
  });

  it('keeps every shape inside the box, thumb and hero', () => {
    for (const box of [THUMB_BOX, HERO_BOX]) {
      for (const id of ids) {
        for (const s of coverSpec(id, theme, box).shapes) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(box.w + 1e-9);
          expect(s.y + s.h).toBeLessThanOrEqual(box.h + 1e-9);
          expect(s.w).toBeGreaterThan(0);
          expect(s.h).toBeGreaterThan(0);
        }
      }
    }
  });

  it('different ids give different specs', () => {
    const distinct = new Set(ids.map((id) => JSON.stringify(coverSpec(id, theme, THUMB_BOX))));
    expect(distinct.size).toBeGreaterThanOrEqual(10);
    expect(coverSpec(ids[0]!, theme, THUMB_BOX)).not.toEqual(coverSpec(ids[1]!, theme, THUMB_BOX));
  });

  it('names tokens only, never colours', () => {
    for (const id of ids) {
      for (const s of coverSpec(id, theme, THUMB_BOX).shapes) {
        expect(COVER_TOKENS).toContain(s.token);
        expect(s.token).not.toMatch(/[#(]/);
        expect(s.opacity === undefined || (s.opacity > 0 && s.opacity <= 1)).toBe(true);
      }
    }
  });
});

it('beton: a surface ground, two ink slabs and one rust bar', () => {
  const tokens = coverSpec(ids[3]!, 'beton', THUMB_BOX).shapes.map((s) => s.token);
  expect(tokens).toEqual(['surface', 'ink', 'ink', 'accent']);
});

it('beton hero adds a third slab and a horizon line', () => {
  const thumb = coverSpec(ids[3]!, 'beton', THUMB_BOX).shapes;
  const hero = coverSpec(ids[3]!, 'beton', HERO_BOX).shapes;
  expect(hero.length).toBe(thumb.length + 2);
  expect(hero.at(-1)!.h).toBe(1);
});

it('the hero is 200px tall', () => {
  expect(HERO_BOX.h).toBe(200);
});

it('willis: a surface ground and one light slit with its glow', () => {
  const shapes = coverSpec(ids[3]!, 'willis', THUMB_BOX).shapes;
  expect(shapes[0]!.token).toBe('surface');
  expect(shapes.slice(1).every((s) => s.token === 'ink')).toBe(true);
  expect(shapes.length).toBeGreaterThan(2);
});

it('an unknown theme falls back to beton', () => {
  expect(coverSpec(ids[0]!, 'nope', THUMB_BOX)).toEqual(coverSpec(ids[0]!, 'beton', THUMB_BOX));
});

it('fnv1a is the 32-bit FNV-1a (known vectors)', () => {
  expect(fnv1a('')).toBe(0x811c9dc5);
  expect(fnv1a('a')).toBe(0xe40c292c);
  expect(fnv1a('foobar')).toBe(0xbf9cf968);
});
