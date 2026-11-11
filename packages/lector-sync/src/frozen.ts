// Storage/wire identifiers. Every value below is persisted or exchanged between devices, so none
// may change when the project is renamed (openspec rename-to-lector, design D1). Guarded by
// test/frozen-ids.test.ts. No imports.

// frozen: storage/wire identifier — see openspec rename-to-lector
export const SYNC_SALT = 'readerlog-sync-v1';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const ENVELOPE_AAD_PREFIX = 'readerlog/v1';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const QR_PREFIX = 'readerlog:sync:1:';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const TAG_ID_LABEL = 'readerlog-tag-v1';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const ITEM_TAG_ID_LABEL = 'readerlog-item-tag-v1';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const CAPTURE_ID_LABEL = 'readerlog-capture-v1';
// frozen: storage/wire identifier — see openspec rename-to-lector
export const HIGHLIGHT_ID_LABEL = 'readerlog-highlight-v1';
