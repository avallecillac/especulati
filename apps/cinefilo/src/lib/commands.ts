import type { Command, Rejection } from '@especulati/cinefilo-core';
import { memberStatusIdFor, ratingIdFor, recommendationIdFor, titleIdFor } from './ids.ts';

type Of<K extends Command['kind']> = Extract<Command, { kind: K }>;

/**
 * What the UI sends. The shell fills what it owns: derived ids (hashed here, labels built by core) and the
 * device's member (`meta.member_id`), so a screen can never name another member. `ReconcileTitles` is the
 * worker's own and is not sendable. Personal-list commands (D2) never name a member: the shell uses this device's
 * member, and the partner for `Recommend`.
 */
export type UiCommand =
  | Omit<Of<'AddTitle'>, 'titleId' | 'addedBy' | 'memberStatusId'>
  | Omit<Of<'SetStars'>, 'memberId' | 'ratingId'>
  | Omit<Of<'SetReview'>, 'memberId' | 'ratingId'>
  | Omit<Of<'SetMyStatus'>, 'memberId' | 'memberStatusId'>
  | Omit<Of<'SetMySeason'>, 'memberId' | 'memberStatusId'>
  | Omit<Of<'Recommend'>, 'fromMember' | 'toMember' | 'recommendationId'>
  | Omit<Of<'AnswerRecommendation'>, 'memberId' | 'memberStatusId'>
  | Exclude<
      Command,
      | Of<'AddTitle'> | Of<'SetStars'> | Of<'SetReview'> | Of<'SetMyStatus'> | Of<'SetMySeason'> | Of<'Recommend'> | Of<'AnswerRecommendation'> | Of<'ReconcileTitles'>
    >;

type Resolved = { ok: true; cmd: Command } | { ok: false; error: Rejection };

/**
 * The core command for a UI command, given the member this device acts as (null before "who am I") and the partner
 * (the earliest-created other live member, null while alone).
 */
export async function resolveCommand(me: string | null, cmd: UiCommand, partner: string | null = null): Promise<Resolved> {
  switch (cmd.kind) {
    case 'AddTitle': {
      if (me === null) return { ok: false, error: { kind: 'UnknownMember' } };
      const titleId = await titleIdFor(cmd.mediaKind, cmd.title, cmd.year ?? null, cmd.tmdbId);
      const memberStatusId = cmd.to === 'me' ? await memberStatusIdFor(titleId, me) : undefined;
      return { ok: true, cmd: { ...cmd, titleId, addedBy: me, ...(memberStatusId ? { memberStatusId } : {}) } };
    }
    case 'SetMyStatus':
    case 'SetMySeason':
    case 'AnswerRecommendation': {
      if (me === null) return { ok: false, error: { kind: 'UnknownMember' } };
      return { ok: true, cmd: { ...cmd, memberId: me, memberStatusId: await memberStatusIdFor(cmd.titleId, me) } as Command };
    }
    case 'Recommend': {
      if (me === null || partner === null) return { ok: false, error: { kind: 'UnknownMember' } };
      return { ok: true, cmd: { ...cmd, fromMember: me, toMember: partner, recommendationId: await recommendationIdFor(cmd.titleId, me, partner) } };
    }
    case 'SetStars':
    case 'SetReview': {
      if (me === null) return { ok: false, error: { kind: 'UnknownMember' } };
      const ratingId = await ratingIdFor(cmd.titleId, me);
      return { ok: true, cmd: { ...cmd, memberId: me, ratingId } as Command };
    }
    default:
      return { ok: true, cmd };
  }
}
