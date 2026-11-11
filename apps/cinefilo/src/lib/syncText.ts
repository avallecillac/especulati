import type { SyncError } from '@especulati/sync';

export const syncErrorText = (kind: SyncError['kind']): string =>
  kind === 'format' || kind === 'checksum' ? 'That code has a typo.'
  : kind === 'notFound' ? 'No shared list found for this code.'
  : kind === 'offline' ? "You're offline. Connect to the internet and try again."
  : "The sync server isn't answering. Try again in a moment.";

export const GENERIC_FAILURE = 'Something went wrong on this device. Try again.';
