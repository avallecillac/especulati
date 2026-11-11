import { afterEach, describe, expect, it, vi } from 'vitest';

// dbClient builds its worker when it is imported, so the globals are stubbed first.
async function load(postMessage: (m: unknown) => void) {
  vi.resetModules();
  class FakeWorker {
    onmessage: unknown = null;
    postMessage = postMessage;
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => undefined });
  vi.stubGlobal('BroadcastChannel', class { onmessage: unknown = null; });
  return import('./dbClient.ts');
}

afterEach(() => vi.unstubAllGlobals());

describe('dbClient send()', () => {
  it('settles with a Storage error when postMessage throws synchronously (e.g. DataCloneError)', async () => {
    let calls = 0;
    const client = await load(() => {
      // The first call is the visibility control message at import time.
      if (++calls > 1) throw new DOMException('could not be cloned', 'DataCloneError');
    });
    const r = await Promise.race([
      client.query({ name: 'allTags' }),
      new Promise<'pending'>((res) => setTimeout(() => res('pending'), 200)),
    ]);
    expect(r).not.toBe('pending');
    expect(r).toMatchObject({ ok: false, error: { kind: 'Storage' } });
  });
});
