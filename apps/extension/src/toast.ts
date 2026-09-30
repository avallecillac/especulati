// Injected into the page (research R3): a small toast in a shadow DOM, so the page's CSS can't
// touch it and it can't touch the page. It talks to the service worker only through
// chrome.runtime.sendMessage. The shadow root is open so tests can reach it.

export interface CapturePayload {
  url: string;
  title: string;
  author: string | null;
  words: number | null;
  at: string;
  readOn: string;
}

export type ToastState =
  | { kind: 'logged'; title: string; site: string; minutes: number | null; itemId: string; undoMs: number }
  | { kind: 'duplicate'; title: string; readOn: string; capture: CapturePayload }
  | { kind: 'error'; message: string }
  | { kind: 'undone' };

const HOST_ID = 'readerlog-toast';

const CSS = `
  :host { all: initial; }
  .toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 360px;
    box-sizing: border-box; padding: 12px 14px; border-radius: 10px; background: #1f2933; color: #fff;
    font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
  .title { font-weight: 600; margin: 0 0 2px; overflow-wrap: anywhere; }
  .line { margin: 0; color: #d0d7de; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 4px 10px; background: #3e4c59; color: #fff; }
  button.primary { background: #2f80ed; }
`;

let timer: ReturnType<typeof setTimeout> | undefined;

function send(message: unknown): void {
  void chrome.runtime.sendMessage(message);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'primary' : '', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const formatDate = (readOn: string): string => {
  const d = new Date(`${readOn}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? readOn : d.toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'medium' });
};

export function hideToast(): void {
  clearTimeout(timer);
  document.getElementById(HOST_ID)?.remove();
}

export function showToast(state: ToastState): void {
  hideToast();
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = el('div', 'toast');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  const row = el('div', 'row');
  let dismissMs: number | null = null;

  if (state.kind === 'logged') {
    box.append(el('p', 'title', state.title));
    box.append(el('p', 'line', ['Logged', state.site, state.minutes === null ? null : `~${state.minutes} min`].filter((x) => x !== null).join(' · ')));
    const itemId = state.itemId;
    row.append(
      button('Undo', () => {
        hideToast();
        send({ type: 'undo', itemId });
      }),
    );
    dismissMs = state.undoMs;
  } else if (state.kind === 'duplicate') {
    box.append(el('p', 'title', state.title));
    box.append(el('p', 'line', `Already logged on ${formatDate(state.readOn)}`));
    const capture = state.capture;
    row.append(
      button(
        'Log again',
        () => {
          hideToast();
          send({ type: 'logAgain', capture });
        },
        true,
      ),
      button('Cancel', hideToast),
    );
  } else if (state.kind === 'error') {
    box.append(el('p', 'title', state.message));
    dismissMs = 5000;
  } else {
    box.append(el('p', 'title', 'Removed'));
    dismissMs = 2000;
  }

  if (row.childElementCount > 0) box.append(row);
  root.append(style, box);
  document.documentElement.append(host);
  if (dismissMs !== null) timer = setTimeout(hideToast, dismissMs);
}

(globalThis as { __readerlogToast?: (s: ToastState) => void }).__readerlogToast = showToast;
