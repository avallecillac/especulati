// Release guard (research R3): the shipped manifest must request no host_permissions.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', dir, 'manifest.json'), 'utf8'));
if ('host_permissions' in manifest) {
  console.error(`check-manifest: ${dir}/manifest.json must not have host_permissions`);
  process.exit(1);
}
// No test hooks in a release: the e2e-only `globalThis.lector` must be tree-shaken out of the bundle.
const root = resolve(import.meta.dirname, '..', dir);
for (const file of ['sw.js', ...readdirSync(resolve(root, 'chunks')).map((f) => `chunks/${f}`)]) {
  if (/\.lector\s*=|__E2E__/.test(readFileSync(resolve(root, file), 'utf8'))) {
    console.error(`check-manifest: ${dir}/${file} contains the e2e test hook`);
    process.exit(1);
  }
}
console.log(`check-manifest: ${dir}/manifest.json ok`);
