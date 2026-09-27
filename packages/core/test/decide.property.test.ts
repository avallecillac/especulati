import { describe, expect, it } from 'vitest';
import { decide, deriveStatus, lastPage, type BookSnapshot, type BookStatus, type Command, type EventType } from '../src/index.ts';
import { applyToSnapshot, eventId, instant, itemId } from './fixtures.ts';

/** Deterministic PRNG (mulberry32) — randomness lives in the test, never in core. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RefEvent { id: string; type: EventType; page: number | null; date: string; at: string; removed: boolean }

/** Naive reference model: what a person would compute by hand (SC-005). */
function reference(events: RefEvent[]): { status: BookStatus; lastPage: number | null } {
  const live = events.filter((e) => !e.removed).sort((a, b) => (a.date + a.at + a.id).localeCompare(b.date + b.at + b.id));
  const last = live[live.length - 1];
  const status: BookStatus = !last ? 'queued' : last.type === 'finished' ? 'finished' : last.type === 'abandoned' ? 'abandoned' : 'reading';
  const withPage = live.filter((e) => e.page !== null);
  return { status, lastPage: withPage.length ? withPage[withPage.length - 1]!.page : null };
}

describe('decide: random command sequences vs. the reference model', () => {
  it('status and lastPage always match; invariants 1, 2 and 5 hold (1000 sequences)', () => {
    for (let seq = 0; seq < 1000; seq++) {
      const rand = prng(seq + 1);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
      const total = rand() < 0.3 ? null : 50 + Math.floor(rand() * 400);
      let snapshot: BookSnapshot | null = null;
      const ref: RefEvent[] = [];
      let n = 0;
      const now = () => instant(`2026-09-27T12:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`);

      const add: Command = { kind: 'AddBook', itemId: itemId(1), title: 'T', totalPages: total, startNow: rand() < 0.5, startEventId: eventId(0), localDate: '2026-09-10' };
      const first = decide(null, add, now());
      expect(first.ok).toBe(true);
      snapshot = applyToSnapshot(null, first.ok ? first.value.changes : []);
      if (add.kind === 'AddBook' && add.startNow) ref.push({ id: eventId(0), type: 'started', page: null, date: '2026-09-10', at: now(), removed: false });

      for (let step = 0; step < 25; step++) {
        n++;
        let cmd: Command;
        if (rand() < 0.2 && ref.length > 0) {
          cmd = { kind: 'RemoveEvent', itemId: itemId(1), eventId: pick(ref).id };
        } else {
          const type = pick(['started', 'progress', 'progress', 'progress', 'finished', 'abandoned'] as const);
          const page = type === 'progress' && rand() < 0.8 ? 1 + Math.floor(rand() * (total ?? 500) * 1.1) : null;
          const date = `2026-09-${String(10 + Math.floor(rand() * 15)).padStart(2, '0')}`;
          cmd = { kind: 'LogEvent', itemId: itemId(1), eventId: eventId(n), type, page, localDate: date };
        }
        const t = now();
        const before = snapshot;
        const r = decide(snapshot, cmd, t);
        // 1. deterministic
        expect(decide(before, cmd, t)).toEqual(r);
        if (!r.ok) {
          // 2. a rejection carries no changes (Result shape) — and state is untouched
          expect(r).not.toHaveProperty('value');
          continue;
        }
        // 5. existing events only ever get deleted_at
        for (const c of r.value.changes) {
          if (c.tbl === 'reading_events' && snapshot!.events.some((e) => e.id === c.rowId)) expect(Object.keys(c.fields)).toEqual(['deleted_at']);
        }
        snapshot = applyToSnapshot(snapshot, r.value.changes);
        if (cmd.kind === 'LogEvent') ref.push({ id: cmd.eventId, type: cmd.type, page: cmd.page ?? null, date: cmd.localDate, at: t, removed: false });
        if (cmd.kind === 'RemoveEvent') ref.find((e) => e.id === cmd.eventId)!.removed = true;

        const expected = reference(ref);
        expect({ status: deriveStatus(snapshot!.events), lastPage: lastPage(snapshot!.events) }).toEqual(expected);
      }
    }
  });
});
