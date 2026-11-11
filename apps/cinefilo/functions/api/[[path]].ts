import { handle } from '../../../relay/src/handler.ts';
import { d1Store, type D1Database } from '../../../relay/src/d1Store.ts';

interface Ctx {
  request: Request;
  env: { CINEFILO_RELAY_DB: D1Database };
}

export const onRequest = (ctx: Ctx): Promise<Response> =>
  handle(ctx.request, d1Store(ctx.env.CINEFILO_RELAY_DB), Date.now);
