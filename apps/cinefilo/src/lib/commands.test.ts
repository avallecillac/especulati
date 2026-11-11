import { describe, expect, it } from 'vitest';
import { resolveCommand } from './commands.ts';
import { memberStatusIdFor, ratingIdFor, recommendationIdFor, titleIdFor } from './ids.ts';

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

describe('resolveCommand: personal lists', () => {
  const PARTNER = '00000000-0000-4000-8000-0000000000b1';
  it('fills my member and the derived status id, never a member the UI names', async () => {
    const r = await resolveCommand(ME, { kind: 'SetMyStatus', titleId: FILM, status: 'later', ...({ memberId: 'someone else' } as object) });
    expect(r).toMatchObject({ ok: true, cmd: { memberId: ME, memberStatusId: await memberStatusIdFor(FILM, ME) } });
    const s = await resolveCommand(ME, { kind: 'SetMySeason', titleId: FILM, season: 2 });
    expect(s).toMatchObject({ ok: true, cmd: { memberId: ME, memberStatusId: await memberStatusIdFor(FILM, ME) } });
  });
  it('Add "Just me" gets the status id; a Together add does not', async () => {
    const me = await resolveCommand(ME, { kind: 'AddTitle', mediaKind: 'movie', title: 'Ran', year: 1985, to: 'me' });
    expect(me).toMatchObject({ ok: true, cmd: { kind: 'AddTitle', to: 'me', addedBy: ME } });
    expect(me.ok && 'memberStatusId' in me.cmd && me.cmd.memberStatusId).toBe(await memberStatusIdFor(await titleIdFor('movie', 'Ran', 1985, null), ME));
    const together = await resolveCommand(ME, { kind: 'AddTitle', mediaKind: 'movie', title: 'Ran', year: 1985 });
    expect(together.ok && 'memberStatusId' in together.cmd).toBe(false);
  });
  it('Recommend goes from me to the partner with the derived id; Answer fills my member', async () => {
    expect(await resolveCommand(ME, { kind: 'Recommend', titleId: FILM }, PARTNER)).toMatchObject({
      ok: true, cmd: { fromMember: ME, toMember: PARTNER, recommendationId: await recommendationIdFor(FILM, ME, PARTNER) },
    });
    expect(await resolveCommand(ME, { kind: 'AnswerRecommendation', id: FILM, titleId: FILM, answer: 'accepted' })).toMatchObject({
      ok: true, cmd: { memberId: ME, memberStatusId: await memberStatusIdFor(FILM, ME) },
    });
  });
  it('refuses personal commands before "who am I", and Recommend without a partner', async () => {
    expect(await resolveCommand(null, { kind: 'SetMyStatus', titleId: FILM, status: 'later' })).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
    expect(await resolveCommand(ME, { kind: 'Recommend', titleId: FILM }, null)).toEqual({ ok: false, error: { kind: 'UnknownMember' } });
  });
  it('passes Withdraw through', async () => {
    const cmd = { kind: 'WithdrawRecommendation', id: FILM } as const;
    expect(await resolveCommand(ME, cmd, PARTNER)).toEqual({ ok: true, cmd });
  });
});
