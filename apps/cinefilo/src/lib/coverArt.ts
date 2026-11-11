/**
 * Generated covers (openspec add-cinefilo-themes, D4). `coverSpec` is pure: a title id and a theme id give the
 * same shapes on every device, drawn only in token names (never colours), and the shapes stay inside the box.
 * Béton: two ink slabs and one rust bar on a surface ground. Willis: one light slit with a glow at a hashed height.
 */
export type CoverToken = 'surface' | 'ink' | 'accent';
export const COVER_TOKENS: readonly CoverToken[] = ['surface', 'ink', 'accent'];

export interface CoverBox { readonly w: number; readonly h: number }
export interface CoverShape { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly token: CoverToken; readonly opacity?: number }
export interface CoverSpec { readonly box: CoverBox; readonly shapes: readonly CoverShape[] }

/** List rows (52×72) and the title screen header (full width). */
export const THUMB_BOX: CoverBox = { w: 52, h: 72 };
export const HERO_BOX: CoverBox = { w: 390, h: 200 };

/** 32-bit FNV-1a over the UTF-16 code units. */
export function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function shape(box: CoverBox, x: number, y: number, w: number, h: number, token: CoverToken, opacity?: number): CoverShape {
  const cx = Math.min(Math.max(0, x), box.w - 1);
  const cy = Math.min(Math.max(0, y), box.h - 1);
  const s = { x: r2(cx), y: r2(cy), w: r2(Math.min(w, box.w - cx)), h: r2(Math.min(h, box.h - cy)), token };
  return opacity === undefined ? s : { ...s, opacity };
}

export function coverSpec(titleId: string, themeId: string, box: CoverBox = THUMB_BOX): CoverSpec {
  const i = fnv1a(titleId) % 1021;
  const sx = box.w / THUMB_BOX.w;
  const sy = box.h / THUMB_BOX.h;
  const ground = shape(box, 0, 0, box.w, box.h, 'surface');

  if (themeId === 'willis') {
    const th = (2 + (i % 3)) * (box.h > 100 ? 1.5 : 1);
    const top = (12 + ((i * 17) % 46)) * sy;
    const band = (pad: number, opacity: number) => shape(box, 0, top - pad, box.w, th + pad * 2, 'ink', opacity);
    return {
      box,
      shapes: [ground, band(th * 5, 0.06), band(th * 2.2, 0.12), band(0, 0.9), shape(box, 0, top + th + (box.h > 100 ? 22 : 8 * sy), box.w, 1, 'ink', 0.25)],
    };
  }

  const hero = box.h > 100;
  const ax = 6 + ((i * 7) % 18);
  const ay = 8 + ((i * 11) % 30);
  return {
    box,
    shapes: [
      ground,
      shape(box, ax * sx, ay * sy, (22 + ((i * 5) % 16)) * sx, (14 + ((i * 9) % 22)) * sy, 'ink'),
      shape(box, (4 + ((i * 13) % 20)) * sx, Math.max(3, ay - 5) * sy, (14 + ((i * 3) % 14)) * sx, 4 * sy, 'ink'),
      shape(box, ((i * 13) % 26) * sx, (40 + ((i * 5) % 20)) * sy, (10 + ((i * 3) % 12)) * sx, 6 * sy, 'accent'),
      // Hero only: a tall third slab and a thin horizon line, as in the section drawing.
      ...(hero
        ? [
            shape(box, box.w * (0.45 + (i % 5) * 0.06), box.h * 0.42, box.w * 0.18, box.h * 0.4, 'accent'),
            shape(box, 0, box.h * 0.83, box.w, 1, 'ink'),
          ]
        : []),
    ],
  };
}
