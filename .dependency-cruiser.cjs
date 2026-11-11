/** Mechanical enforcement of constitution IV (functional core, imperative shell). */
module.exports = {
  forbidden: [
    {
      name: 'sync-core-is-pure',
      comment: 'packages/sync-core may only import itself — no npm modules, no other workspace packages, no node builtins.',
      severity: 'error',
      from: { path: '^packages/sync-core/src' },
      to: { pathNot: '^packages/sync-core/src' },
    },
    {
      name: 'core-is-pure',
      comment: 'packages/lector-core may only import itself and the pure packages/sync-core — no npm modules, no node builtins.',
      severity: 'error',
      from: { path: '^packages/lector-core/src' },
      // Workspace packages are bare specifiers that depcruise leaves unresolved, so match the name too.
      to: { pathNot: '^(packages/(lector-core|sync-core)/src|@especulati/sync-core$)' },
    },
    {
      name: 'shared-no-apps-domain',
      comment: 'The shared packages (sync-core, db-kit, sync) know no app: no lector-*/cinefilo-* package and nothing under apps/.',
      severity: 'error',
      from: { path: '^packages/(sync-core|db-kit|sync)/' },
      to: { path: '^packages/(lector|cinefilo)-|^apps/|^@especulati/(lector|cinefilo)-' },
    },
    {
      name: 'db-no-ui',
      severity: 'error',
      from: { path: '^packages/lector-db' },
      to: { path: '^apps/' },
    },
    {
      name: 'relay-is-opaque',
      comment: 'The relay never sees plaintext or shared logic (constitution: zero-knowledge relay).',
      severity: 'error',
      from: { path: '^apps/relay' },
      to: { path: '^packages/' },
    },
    {
      name: 'relay-adapters',
      comment: "A Pages Functions adapter (functions/ or apps/<app>/functions/) only wires the relay: from apps/ it may import apps/relay/src alone.",
      severity: 'error',
      from: { path: ['^functions/', '^apps/[a-z-]+/functions/'] },
      to: { path: '^apps/', pathNot: '^apps/relay/src/' },
    },
    {
      name: 'sync-no-apps',
      severity: 'error',
      from: { path: '^packages/sync' },
      to: { path: '^apps/' },
    },
    {
      name: 'extension-no-pwa-no-db',
      comment: 'The extension bundle must not contain SQLite or the PWA (feature 005).',
      severity: 'error',
      from: { path: '^apps/lector-extension' },
      to: { path: '^packages/lector-db|^apps/lector/' },
    },
    {
      name: 'lector-sync-no-db',
      comment: 'The capture peer and lector sync config stay free of SQLite, so the extension bundle has no WASM (feature 005).',
      severity: 'error',
      from: { path: '^packages/lector-sync/' },
      to: { path: '^packages/(lector-db|db-kit)|^@especulati/(lector-db|db-kit)$' },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '(^|/)(test|dist|node_modules)/' },
  },
};
