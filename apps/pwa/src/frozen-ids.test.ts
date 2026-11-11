// Guard for the storage/wire identifiers frozen by openspec rename-to-lector (design D1).
// If one of these fails, a string that is persisted on devices or exchanged between them has
// changed: revert the change, do not update the expectation.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { ReaderlogDb, TAG_ID_LABEL } from '@readerlog/db';
import { captureId, highlightCaptureId, saveCaptureId } from './lib/capture.ts';
import * as F from './lib/frozen.ts';
import { dismissalId, mergeCopyId, uuidFromHash } from './lib/ids.ts';
import { highlightCopyId, itemTagId } from './lib/reconcile.ts';
import { DB_FILE, LOCK, SAH_POOL_NAME } from './worker/frozen.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sqlite3 = await sqlite3InitModule();

describe('frozen worker identifiers', () => {
  it('DB file, SAH-pool VFS name and Web Lock name', () => {
    expect(DB_FILE).toBe('/readerlog.db');
    expect(SAH_POOL_NAME).toBe('readerlog-sahpool');
    expect(LOCK).toBe('readerlog-db');
  });

  it('db.worker.ts uses the frozen constants and has no inline copies', () => {
    const src = read('./worker/db.worker.ts');
    expect(src).toContain('installOpfsSAHPoolVfs({ name: SAH_POOL_NAME })');
    expect(src).toContain('new pool.OpfsSAHPoolDb(DB_FILE)');
    expect(src).not.toMatch(/'readerlog[-./]/);
  });
});

describe('frozen appearance and cache names', () => {
  it('appearance key, in code and in the pre-paint script', () => {
    expect(F.APPEARANCE_KEY).toBe('readerlog.appearance');
    expect(read('./lib/appearance.svelte.ts')).toContain('const KEY = APPEARANCE_KEY;');
    expect(read('../index.html')).toContain('localStorage.getItem("readerlog.appearance")');
  });

  it('font cache name', () => {
    expect(read('../vite.config.ts')).toContain("cacheName: 'readerlog-fonts'");
  });
});

describe('frozen derived-id labels', () => {
  it('the literals are unchanged', () => {
    expect(F.MERGE_COPY_LABEL).toBe('readerlog-merge-v2');
    expect(F.DISMISSAL_LABEL).toBe('readerlog-dismiss-v1');
    expect(F.HL_COPY_LABEL).toBe('readerlog-hl-copy-v1');
    expect(F.ITEM_TAG_ID_LABEL).toBe('readerlog-item-tag-v1');
    expect(F.CAPTURE_ID_LABEL).toBe('readerlog-capture-v1');
    expect(F.HIGHLIGHT_ID_LABEL).toBe('readerlog-highlight-v1');
    expect(TAG_ID_LABEL).toBe('readerlog-tag-v1');
  });

  it('ids.ts derives from the frozen labels', async () => {
    const e = { type: 'progress', page: 42, occurredAt: '2026-09-01T10:00:00.000Z', localDate: '2026-09-01' };
    expect(await mergeCopyId('S', e)).toBe(await uuidFromHash('readerlog-merge-v2|S|progress|42|2026-09-01T10:00:00.000Z|2026-09-01'));
    expect(await dismissalId('b', 'a')).toBe(await uuidFromHash('readerlog-dismiss-v1|a|b'));
  });

  it('reconcile.ts derives from the frozen labels', async () => {
    const h = { quote: 'q', note: null, page: 3, createdAt: '2026-09-01T10:00:00.000Z', localDate: '2026-09-01' };
    expect(await highlightCopyId('S', h)).toBe(
      await uuidFromHash(`readerlog-hl-copy-v1|S|${JSON.stringify(['q', null, 3, '2026-09-01T10:00:00.000Z', '2026-09-01'])}`),
    );
    expect(await itemTagId('i', 't')).toBe(await uuidFromHash('readerlog-item-tag-v1|i|t'));
  });

  it('capture.ts derives from the frozen labels', async () => {
    const c = { url: 'https://example.org/a', at: '2026-09-01T10:00:00.000Z' };
    expect(await captureId(c)).toBe(await uuidFromHash('readerlog-capture-v1|https://example.org/a|2026-09-01T10:00:00.000Z'));
    expect(await saveCaptureId(c)).toBe(await uuidFromHash('readerlog-capture-v1|https://example.org/a|2026-09-01T10:00:00.000Z|later'));
    expect(await highlightCaptureId(c.url, c.at)).toBe(await uuidFromHash('readerlog-highlight-v1|https://example.org/a|2026-09-01T10:00:00.000Z'));
  });

  it('packages/db tags.ts hashes `readerlog-tag-v1|<key>`', async () => {
    const db = new ReaderlogDb(new sqlite3.oo1.DB(':memory:'));
    db.migrate();
    const labels: string[] = [];
    await db.resolveTagId('Hello', (label) => {
      labels.push(label);
      return Promise.resolve('00000000-0000-4000-8000-000000000001');
    });
    expect(labels).toEqual(['readerlog-tag-v1|hello']);
  });
});
