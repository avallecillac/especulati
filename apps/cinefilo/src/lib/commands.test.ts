import { describe, expect, it } from 'vitest';
import { resolveCommand } from './commands.ts';
import { ratingIdFor, titleIdFor } from './ids.ts';

const ME = '00000000-0000-4000-8000-0000000000a1';
const FILM = '00000000-0000-4000-8000-0000000000f1';

describe('resolveCommand', () => {
  it('derives the title id from the TMDB id, or from kind, normalized title and year', async () => {
    const t = await resolveCommand(ME, { kind: 'AddTitle', mediaKind: 'movie', title: 'The Matrix', tmdbId: 603 });
    expect(t).toMatchObject({ ok: true, cmd: { kind: 'AddTitle', addedBy: ME, titleId: await titleIdFor('movie', 'x', null, 603) } });
    const a = await resolveCommand(ME, { kind: 'AddTitle', mediaKind: 'movie', title: 'Amélie', year: 2001 });
    const b = await resolveCommand(ME, { kind: 'AddTitle', mediaKind: 'movie', title: '  amelie ', year: 2001 });
    expect(a.ok && b.ok && a.cmd.kind === 'AddTitle' && b.cmd.kind === 'AddTitle' && a.cmd.titleId === b.cmd.titleId).toBe(true);
  });

  it('fills the rating id and the device member, never a member the UI names', async () => {
    const r = await resolveCommand(ME, { kind: 'SetVerdict', titleId: FILM, verdict: 'like', ...({ memberId: 'someone else' } as object) });
    expect(r).toMatchObject({ ok: true, cmd: { memberId: ME, ratingId: await ratingIdFor(FILM, ME) } });
  });

  it('refuses member-bound commands before "who am I"', async () => {
    expect(await resolveCommand(null, { kind: 'SetReview', titleId: FILM, review: 'x' })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    expect(await resolveCommand(null, { kind: 'AddTitle', mediaKind: 'movie', title: 'x' })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
  });

  it('passes other commands through', async () => {
    const cmd = { kind: 'RemoveTitle', titleId: FILM } as const;
    expect(await resolveCommand(null, cmd)).toEqual({ ok: true, cmd });
  });
});
