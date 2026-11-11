// Storage identifiers of Cinéfilo's on-device database (openspec add-cinefilo, design). Guarded by
// src/frozen-ids.test.ts. Kept apart from db.worker.ts so a test can import them without
// starting the worker. Changing one orphans local data. No imports.

// frozen: storage/wire identifier — see openspec add-cinefilo
export const LOCK = 'cinefilo-db';
// frozen: storage/wire identifier — see openspec add-cinefilo
export const DB_FILE = '/cinefilo.db';
// frozen: storage/wire identifier — see openspec add-cinefilo
export const SAH_POOL_NAME = 'cinefilo-sahpool';
// frozen: storage/wire identifier — see openspec add-cinefilo
export const CHANNEL = 'cinefilo-changes';
