import { handle } from '../../apps/relay/src/handler.ts';
import { d1Store, type D1Database } from '../../apps/relay/src/d1Store.ts';

interface Ctx {
  request: Request;
  env: { RELAY_DB: D1Database };
}

export const onRequest = (ctx: Ctx): Promise<Response> =>
  handle(ctx.request, d1Store(ctx.env.RELAY_DB), Date.now);
