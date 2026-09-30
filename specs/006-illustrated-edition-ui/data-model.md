# Data Model: Illustrated-Edition UI and Themes (006)

**No database, schema, sync or export changes.** `SCHEMA_VERSION` is unchanged.

| Entity | Where | Shape | Notes |
|---|---|---|---|
| Theme | `src/theme/themes.ts` plus `src/theme/<id>.css` | `{ id, name, scheme, swatch, themeColor }` plus all tokens (contracts/theme-tokens.md) | Static app code |
| Appearance preference | `localStorage['readerlog.appearance']` | `'automatic' \| 'macondo' \| 'patriarca'` | Per device. Not synced, not exported. An invalid value means `automatic` |

**Resolution:** `resolve(pref, systemDark) = pref === 'automatic' ? (systemDark ?
DEFAULT_DARK : DEFAULT_LIGHT) : (known(pref) ? pref : resolve('automatic', systemDark))`.
