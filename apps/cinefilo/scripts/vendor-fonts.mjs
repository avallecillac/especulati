// Copies the Latin and Latin Extended woff2 subsets (only the weights Cinéfilo uses) and the OFL licence
// files from the Fontsource devDependencies into public/fonts/. Run: pnpm --filter cinefilo vendor-fonts
// The output is committed; the packages are only needed to refresh it.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');

// package, file-name stem, weight tags to copy (variable fonts use "wght")
const FAMILIES = [
  ['@fontsource-variable/archivo', 'archivo', ['wght']],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono', ['400', '500']],
  ['@fontsource/italiana', 'italiana', ['400']],
  ['@fontsource/libre-caslon-display', 'libre-caslon-display', ['400']],
  ['@fontsource-variable/inter', 'inter', ['wght']],
];

mkdirSync(OUT, { recursive: true });
for (const [pkg, stem, weights] of FAMILIES) {
  const root = dirname(require.resolve(`${pkg}/package.json`));
  const files = readdirSync(join(root, 'files'));
  let copied = 0;
  for (const w of weights) {
    for (const subset of ['latin', 'latin-ext']) {
      const name = `${stem}-${subset}-${w}-normal.woff2`;
      if (!files.includes(name)) continue; // e.g. Italiana has no latin-ext
      copyFileSync(join(root, 'files', name), join(OUT, name));
      copied++;
    }
  }
  if (copied === 0) throw new Error(`no font files copied for ${pkg}`);
  copyFileSync(join(root, 'LICENSE'), join(OUT, `OFL-${stem}.txt`));
}
console.log(`vendored fonts into ${OUT}`);
