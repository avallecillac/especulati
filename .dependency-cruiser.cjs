/** Mechanical enforcement of constitution IV (functional core, imperative shell). */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      comment: 'packages/core may only import itself — no npm modules, no other workspace packages, no node builtins.',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { pathNot: '^packages/core/src' },
    },
    {
      name: 'db-no-ui',
      severity: 'error',
      from: { path: '^packages/db' },
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
      name: 'sync-no-apps',
      severity: 'error',
      from: { path: '^packages/sync' },
      to: { path: '^apps/' },
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
