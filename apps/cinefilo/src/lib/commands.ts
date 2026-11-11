import type { Command, Rejection } from '@especulati/cinefilo-core';
import { ratingIdFor, titleIdFor } from './ids.ts';

type Of<K extends Command['kind']> = Extract<Command, { kind: K }>;

/**
 * What the UI sends. The shell fills what it owns: derived ids (hashed here, labels built by core) and the
 * device's member (`meta.member_id`), so a screen can never name another member. `ReconcileTitles` is the
 * worker's own and is not sendable.
 */
export type UiCommand =
  | Omit<Of<'AddTitle'>, 'titleId' | 'addedBy'>
  | Omit<Of<'SetVerdict'>, 'memberId' | 'ratingId'>
  | Omit<Of<'SetReview'>, 'memberId' | 'ratingId'>
  | Exclude<Command, Of<'AddTitle'> | Of<'SetVerdict'> | Of<'SetReview'> | Of<'ReconcileTitles'>>;

type Resolved = { ok: true; cmd: Command } | { ok: false; error: Rejection };

/** The core command for a UI command, given the member this device acts as (null before "who am I"). */
export async function resolveCommand(me: string | null, cmd: UiCommand): Promise<Resolved> {
  switch (cmd.kind) {
    case 'AddTitle': {
      if (me === null) return { ok: false, error: { kind: 'UnknownMember' } };
      const titleId = await titleIdFor(cmd.mediaKind, cmd.title, cmd.year ?? null, cmd.tmdbId);
      return { ok: true, cmd: { ...cmd, titleId, addedBy: me } };
    }
    case 'SetVerdict':
    case 'SetReview': {
      if (me === null) return { ok: false, error: { kind: 'UnknownMember' } };
      const ratingId = await ratingIdFor(cmd.titleId, me);
      return { ok: true, cmd: { ...cmd, memberId: me, ratingId } as Command };
    }
    default:
      return { ok: true, cmd };
  }
}
