import type { Control, Request, Response } from './protocol.ts';

type Pending = (res: Response) => void;

const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<number, Pending>();
let seq = 0;

// A tab that starts hidden must not grab the DB from the visible one.
worker.postMessage({ kind: 'visibility', visible: document.visibilityState === 'visible' } satisfies Control);
document.addEventListener('visibilitychange', () => {
  worker.postMessage({ kind: 'visibility', visible: document.visibilityState === 'visible' } satisfies Control);
});

worker.onmessage = (ev: MessageEvent<Response>) => {
  const cb = pending.get(ev.data.id);
  pending.delete(ev.data.id);
  cb?.(ev.data);
};

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export function send(req: WithoutId<Request>): Promise<Response> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ ...req, id });
  });
}
