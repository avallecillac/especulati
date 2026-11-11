import { describe, expect, it } from 'vitest';
import { onRequest as lectorOnRequest } from '../../../functions/api/[[path]].ts';
import { onRequest as cinefiloOnRequest } from '../../cinefilo/functions/api/[[path]].ts';
import type { D1Database, D1PreparedStatement } from '../src/d1Store.ts';

const SPACE = 'a'.repeat(32);

/** A D1 stand-in that records every statement and reports one changed row. */
function fakeD1(): { db: D1Database; sql: string[] } {
  const sql: string[] = [];
  const stmt = (): D1PreparedStatement => {
    const s: D1PreparedStatement = {
      bind: () => s,
      first: () => Promise.resolve(null),
      all: () => Promise.resolve({ results: [] }),
      run: () => Promise.resolve({ meta: { changes: 1 } }),
    };
    return s;
  };
  return {
    sql,
    db: {
      prepare: (q) => {
        sql.push(q);
        return stmt();
      },
      batch: () => Promise.resolve([]),
    },
  };
}

const put = () =>
  new Request(`https://x.test/api/v1/spaces/${SPACE}`, { method: 'PUT', headers: { authorization: 'Bearer fixed-fake-token' } });

describe('Pages Functions adapters', () => {
  it('lector adapter routes to the handler through RELAY_DB', async () => {
    const d1 = fakeD1();
    const res = await lectorOnRequest({ request: put(), env: { RELAY_DB: d1.db } });
    expect(res.status).toBe(201);
    expect(d1.sql.some((q) => q.includes('INSERT OR IGNORE INTO spaces'))).toBe(true);
  });

  it('cinefilo adapter routes to the handler through CINEFILO_RELAY_DB', async () => {
    const d1 = fakeD1();
    const res = await cinefiloOnRequest({ request: put(), env: { CINEFILO_RELAY_DB: d1.db } });
    expect(res.status).toBe(201);
    expect(d1.sql.some((q) => q.includes('INSERT OR IGNORE INTO spaces'))).toBe(true);
  });

  it('cinefilo adapter answers 401 for a missing token', async () => {
    const d1 = fakeD1();
    const res = await cinefiloOnRequest({
      request: new Request(`https://x.test/api/v1/spaces/${SPACE}`, { method: 'PUT' }),
      env: { CINEFILO_RELAY_DB: d1.db },
    });
    expect(res.status).toBe(401);
  });
});
