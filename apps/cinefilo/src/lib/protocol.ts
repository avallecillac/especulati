/** UI ↔ DB worker messages. Grows with the domain queries and commands. */
export type Request = { id: number; kind: 'ping' };
export type Control = { kind: 'visibility'; visible: boolean };
export type ClientError = { kind: 'Busy' } | { kind: 'Storage'; message: string };
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ClientError };
