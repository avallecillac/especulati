export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  kind: 'info' | 'error';
}

let next = 0;
export const toasts = $state<{ list: Toast[] }>({ list: [] });

export function showToast(message: string, opts: { action?: Toast['action']; kind?: Toast['kind']; ms?: number } = {}): void {
  const t: Toast = { id: ++next, message, kind: opts.kind ?? 'info', ...(opts.action ? { action: opts.action } : {}) };
  toasts.list = [...toasts.list.slice(-2), t];
  setTimeout(() => dismissToast(t.id), opts.ms ?? 5000);
}

export function dismissToast(id: number): void {
  toasts.list = toasts.list.filter((t) => t.id !== id);
}
