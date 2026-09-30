// Builds the extension: sw + options page, then extract.js and toast.js as separate
// self-contained IIFE bundles (for chrome.scripting.executeScript), plus manifest.json.
import { build } from 'vite';

for (const entry of [undefined, 'extract', 'toast']) {
  if (entry) process.env.EXT_ENTRY = entry;
  else delete process.env.EXT_ENTRY;
  await build({ configFile: new URL('../vite.config.ts', import.meta.url).pathname, logLevel: 'warn' });
}
