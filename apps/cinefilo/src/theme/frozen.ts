// Device-local storage identifiers of the themes (openspec add-cinefilo-themes, D8). Guarded by
// src/frozen-ids.test.ts. No imports. Never synced or exported.

// frozen: storage identifier
export const APPEARANCE_KEY = 'cinefilo.appearance';

// frozen: storage identifier. 'posters' (default, key absent) or 'generated'.
export const COVERS_KEY = 'cinefilo.covers';

// frozen: storage identifier (cinefilo-feedback-1 D5). 'newest' (default, key absent) or 'first': the Together Watched order.
export const WATCHED_ORDER_KEY = 'cinefilo.watchedOrder';

// frozen: storage identifier (cinefilo-feedback-1 D5). 'list' (default, key absent) or 'grid'.
export const LAYOUT_KEY = 'cinefilo.layout';
