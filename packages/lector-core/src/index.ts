// Moved to @especulati/sync-core (extract-shared-sync). Re-exported explicitly so lector call
// sites keep importing from '@especulati/lector-core'.
export {
  compareHlc, err, hlcNext, hlcReceive, mergeOp, ok, parseDeviceId, parseHlc, parseRemoteOpWith, stampOps, UUID_PATTERN,
  type Brand, type DeviceId, type Hlc, type OpWire, type ParseError, type Result, type SyncSchema,
} from '@especulati/sync-core';
export * from './types.ts';
export * from './book.ts';
export * from './commands.ts';
export * from './decide.ts';
export * from './stats.ts';
export * from './merge.ts';
export * from './duplicates.ts';
export * from './url.ts';
export * from './article.ts';
export * from './highlight.ts';
export * from './tags.ts';
export * from './search.ts';
