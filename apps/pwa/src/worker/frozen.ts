// Storage identifiers of the on-device database (openspec rename-to-lector, design D1). Guarded by
// src/frozen-ids.test.ts. Kept apart from db.worker.ts so a test can import them without
// starting the worker. No imports.

// frozen: storage/wire identifier — see openspec rename-to-lector
export const LOCK = 'readerlog-db';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const DB_FILE = '/readerlog.db';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const SAH_POOL_NAME = 'readerlog-sahpool';
