// Cinéfilo's wire identifiers for sync (openspec add-cinefilo, design D9). Changing one splits the
// sync space or makes existing ciphertext unreadable. Guarded by test/frozen.test.ts. No imports.

// frozen: storage/wire identifier — see openspec add-cinefilo
export const SYNC_SALT = 'cinefilo-sync-v1';
// frozen: storage/wire identifier — see openspec add-cinefilo (the engine appends `/<spaceId>/<batchId>`)
export const ENVELOPE_AAD_PREFIX = 'cinefilo/v1';
// frozen: storage/wire identifier — see openspec add-cinefilo
export const QR_PREFIX = 'cinefilo:sync:1:';
