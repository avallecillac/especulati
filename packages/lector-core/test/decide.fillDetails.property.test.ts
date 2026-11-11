import { describe, expect, it } from 'vitest';
import { decide, type BookSnapshot, type Command, type Item } from '../src/index.ts';
import { applyToSnapshot, book, instant, itemId } from './fixtures.ts';

/** Deterministic PRNG (mulberry32) — randomness lives in the test, never in core. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ISBN = '9780593135204' as Item['isbn'];
type Field = 'title' | 'author' | 'genre' | 'totalPages';

describe('decide: FillDetails vs. user edits (invariants 6 and 7, 500 sequences)', () => {
  it('never overwrites a field the user set, and is a no-op once not pending', () => {
    for (let seq = 0; seq < 500; seq++) {
      const rand = prng(seq + 1);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
      let snapshot: BookSnapshot = { item: book({ title: `ISBN ${ISBN}` as Item['title'], isbn: ISBN, totalPages: null, detailsStatus: 'pending' }), events: [] };
      const userSet = new Map<Field, unknown>();
      const now = instant('2026-09-27T12:00:00.000Z');

      for (let step = 0; step < 12; step++) {
        const roll = rand();
        let cmd: Command;
        if (roll < 0.4) {
          const edit: { -readonly [K in keyof Extract<Command, { kind: 'EditBook' }>]?: unknown } = { kind: 'EditBook', itemId: itemId(1) };
          for (const f of ['title', 'author', 'genre', 'totalPages'] as const) {
            if (rand() < 0.4) edit[f] = f === 'totalPages' ? 1 + Math.floor(rand() * 900) : `${f}-${Math.floor(rand() * 1000)}`;
          }
          if (rand() < 0.25) edit['detailsStatus'] = 'complete';
          cmd = edit as Command;
        } else if (roll < 0.85) {
          cmd = {
            kind: 'FillDetails', itemId: itemId(1), outcome: 'found',
            details: {
              ...(rand() < 0.7 ? { title: `Catalog ${Math.floor(rand() * 1000)}` } : {}),
              ...(rand() < 0.7 ? { author: `Cat Author ${Math.floor(rand() * 1000)}` } : {}),
              ...(rand() < 0.7 ? { genre: `Cat Genre ${Math.floor(rand() * 1000)}` } : {}),
              ...(rand() < 0.7 ? { totalPages: 1 + Math.floor(rand() * 900) } : {}),
              ...(rand() < 0.7 ? { coverUrl: `https://c.example/${Math.floor(rand() * 1000)}.jpg` } : {}),
            },
          };
        } else {
          cmd = { kind: 'FillDetails', itemId: itemId(1), outcome: 'notFound' };
        }

        const before = snapshot;
        const r = decide(before, cmd, pick([now]));
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        expect(decide(before, cmd, now)).toEqual(r);

        if (cmd.kind === 'FillDetails' && before.item.detailsStatus !== 'pending') expect(r.value.changes).toEqual([]); // invariant 7
        snapshot = applyToSnapshot(before, r.value.changes)!;

        if (cmd.kind === 'EditBook') {
          if (cmd.title !== undefined) userSet.set('title', snapshot.item.title);
          if (cmd.author !== undefined) userSet.set('author', snapshot.item.author);
          if (cmd.genre !== undefined) userSet.set('genre', snapshot.item.genre);
          if (cmd.totalPages !== undefined) userSet.set('totalPages', snapshot.item.totalPages);
        } else {
          // invariant 6: FillDetails leaves every user-set field untouched
          expect(snapshot.item.title).toBe(userSet.get('title') ?? snapshot.item.title);
          expect(snapshot.item.author).toBe(userSet.has('author') ? userSet.get('author') : snapshot.item.author);
          expect(snapshot.item.genre).toBe(userSet.has('genre') ? userSet.get('genre') : snapshot.item.genre);
          expect(snapshot.item.totalPages).toBe(userSet.has('totalPages') ? userSet.get('totalPages') : snapshot.item.totalPages);
        }
      }
    }
  });
});
