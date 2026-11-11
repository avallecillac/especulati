// Guard for Cinéfilo's storage identifiers (openspec add-cinefilo). If one of these fails, a
// string persisted on devices has changed: revert the change, do not update the expectation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEY, COVERS_KEY } from './theme/frozen.ts';
import { CHANNEL, DB_FILE, LOCK, SAH_POOL_NAME } from './worker/frozen.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('frozen worker identifiers', () => {
  it('DB file, SAH-pool VFS name and Web Lock name', () => {
    expect(DB_FILE).toBe('/cinefilo.db');
    expect(SAH_POOL_NAME).toBe('cinefilo-sahpool');
    expect(LOCK).toBe('cinefilo-db');
    expect(CHANNEL).toBe('cinefilo-changes');
  });

  it('db.worker.ts uses the frozen constants and has no inline copies', () => {
    const src = read('./worker/db.worker.ts');
    expect(src).toContain('installOpfsSAHPoolVfs({ name: SAH_POOL_NAME })');
    expect(src).toContain('new pool.OpfsSAHPoolDb(DB_FILE)');
    expect(src).not.toMatch(/'cinefilo[-./]/);
  });
});

describe('frozen device-local identifiers (add-cinefilo-themes)', () => {
  it('appearance key and theme ids', () => {
    expect(APPEARANCE_KEY).toBe('cinefilo.appearance');
    expect(COVERS_KEY).toBe('cinefilo.covers');
    expect(read('./theme/themes.ts')).toContain("id: 'beton'");
    expect(read('./theme/themes.ts')).toContain("id: 'willis'");
  });

  it('the pre-paint script in index.html reads the same key', () => {
    expect(read('../index.html')).toContain(`getItem("${APPEARANCE_KEY}")`);
  });
});
