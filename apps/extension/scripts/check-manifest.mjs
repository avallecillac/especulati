// Release guard (research R3): the shipped manifest must request no host_permissions.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', dir, 'manifest.json'), 'utf8'));
if ('host_permissions' in manifest) {
  console.error(`check-manifest: ${dir}/manifest.json must not have host_permissions`);
  process.exit(1);
}
console.log(`check-manifest: ${dir}/manifest.json ok`);
