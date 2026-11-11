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
  | { kind: 'saved'; title: string; site: string; itemId: string; undoMs: number }
  | { kind: 'alreadySaved'; title: string }
  | { kind: 'tagsAdded'; message: string }
  | { kind: 'duplicate'; title: string; readOn: string; capture: CapturePayload }
  | { kind: 'highlighted'; highlightId: string; itemId: string; createdArticle: boolean; undoMs: number }
  | { kind: 'noteSaved' }
  | { kind: 'error'; message: string }
  | { kind: 'undone' };

const HOST_ID = 'lector-toast';

const CSS = `
  :host { all: initial; }
  .toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 360px;
    box-sizing: border-box; padding: 12px 14px; border-radius: 10px; background: #1f2933; color: #fff;
    font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
  .title { font-weight: 600; margin: 0 0 2px; overflow-wrap: anywhere; }
  .line { margin: 0; color: #d0d7de; }
  .row { display: flex; gap: 8px; margin-top: 8px; }
  .row[hidden] { display: none; }
  button { font: inherit; cursor: pointer; border: 0; border-radius: 6px; padding: 4px 10px; background: #3e4c59; color: #fff; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 8px; font: inherit; color: #111; background: #fff; border-radius: 6px; border: 0; padding: 6px; }
  textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 8px; font: inherit; color: #111; background: #fff; border-radius: 6px; border: 0; padding: 6px; resize: vertical; }
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

  // Add tags (008): a comma-separated input. It holds the toast open; Esc closes only the input.
  const addTagsButton = (itemId: string, undoMs: number): HTMLButtonElement => {
    const open = (): void => {
      clearTimeout(timer);
      row.hidden = true;
      const input = el('input');
      input.type = 'text';
      input.setAttribute('aria-label', 'Tags');
      input.placeholder = 'ai, design';
      const save = (): void => {
        const text = input.value;
        hideToast();
        if (text.trim() !== '') send({ type: 'addTags', itemId, text });
      };
      const cancel = (): void => {
        form.remove();
        row.hidden = false;
        timer = setTimeout(hideToast, undoMs);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // the page's own shortcuts must not see the user's typing
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
      input.addEventListener('keypress', (e) => e.stopPropagation());
      const form = el('div', 'form');
      const actions = el('div', 'row');
      actions.append(button('Save', save, true), button('Cancel', cancel));
      form.append(input, actions);
      box.append(form);
      input.focus();
    };
    return button('Add tags', open);
  };

  if (state.kind === 'logged') {
    box.append(el('p', 'title', state.title));
    box.append(el('p', 'line', ['Logged', state.site, state.minutes === null ? null : `~${state.minutes} min`].filter((x) => x !== null).join(' · ')));
    const itemId = state.itemId;
    row.append(
      addTagsButton(itemId, state.undoMs),
      button('Undo', () => {
        hideToast();
        send({ type: 'undo', itemId });
      }),
    );
    dismissMs = state.undoMs;
  } else if (state.kind === 'saved') {
    box.append(el('p', 'title', state.title));
    box.append(el('p', 'line', ['Saved for later', state.site].filter((x) => x !== '').join(' · ')));
    const itemId = state.itemId;
    row.append(
      addTagsButton(itemId, state.undoMs),
      button('Undo', () => {
        hideToast();
        send({ type: 'undo', itemId });
      }),
    );
    dismissMs = state.undoMs;
  } else if (state.kind === 'alreadySaved') {
    box.append(el('p', 'title', state.title));
    box.append(el('p', 'line', 'Already saved'));
    dismissMs = 3000;
  } else if (state.kind === 'tagsAdded') {
    box.append(el('p', 'title', state.message));
    dismissMs = 2500;
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
  } else if (state.kind === 'highlighted') {
    box.append(el('p', 'title', 'Highlight saved'));
    const { highlightId, itemId, createdArticle, undoMs } = state;
    const addNote = button('Add note', () => openNote());
    const undo = button('Undo', () => {
      hideToast();
      send({ type: 'undoHighlight', highlightId, itemId, createdArticle });
    });
    row.append(addNote, undo);
    dismissMs = undoMs;

    // The note box holds the toast open; Esc closes only the box and the countdown starts again.
    const openNote = (): void => {
      clearTimeout(timer);
      row.hidden = true;
      const area = el('textarea');
      area.rows = 3;
      area.setAttribute('aria-label', 'Note');
      const save = (): void => {
        const note = area.value;
        hideToast();
        if (note.trim() !== '') send({ type: 'editNote', highlightId, note });
      };
      const cancel = (): void => {
        form.remove();
        row.hidden = false;
        timer = setTimeout(hideToast, undoMs);
      };
      area.addEventListener('keydown', (e) => {
        e.stopPropagation(); // the page's own shortcuts must not see the user's typing
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      area.addEventListener('keyup', (e) => e.stopPropagation());
      area.addEventListener('keypress', (e) => e.stopPropagation());
      const form = el('div', 'form');
      const actions = el('div', 'row');
      actions.append(button('Save', save, true), button('Cancel', cancel));
      form.append(area, actions);
      box.append(form);
      area.focus();
    };
  } else if (state.kind === 'noteSaved') {
    box.append(el('p', 'title', 'Note saved'));
    dismissMs = 2000;
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

(globalThis as { __lectorToast?: (s: ToastState) => void }).__lectorToast = showToast;
