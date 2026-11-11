// Options page: pair with a Lector site, see the status, unpair.
import { createCapturePeer } from '@especulati/sync/capturePeer';
import { chromeStore } from './store.ts';

const peer = createCapturePeer(chromeStore, {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  online: () => navigator.onLine,
});

const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}

function field(label: string, input: HTMLInputElement): HTMLLabelElement {
  const l = el('label', label);
  l.style.display = 'block';
  l.style.margin = '12px 0';
  input.style.display = 'block';
  input.style.width = '100%';
  l.append(input);
  return l;
}

/** The origin from what the user typed: "https://" is assumed. Null if it is not an http(s) origin. */
function originOf(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Ask for the one origin the extension will talk to. Must run first in the click handler (user gesture). */
async function grantOrigin(origin: string): Promise<boolean> {
  const u = new URL(origin);
  const pattern = `${u.protocol}//${u.hostname}/*`;
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function render(message = ''): Promise<void> {
  const s = await peer.status();
  app.replaceChildren(el('h1', 'Lector'));
  const note = el('p', message);
  note.setAttribute('role', 'status');

  if (s.paired) {
    const origin = (await chromeStore.get<string>('appOrigin')) ?? '';
    app.append(el('p', 'Paired'), el('p', `Lector address: ${origin}`));
    app.append(el('p', `Waiting to be sent: ${s.waiting}`));
    app.append(el('p', `Last sent: ${s.lastSentAt === null ? 'never' : new Date(s.lastSentAt).toLocaleString()}`));
    if (s.problem !== null) app.append(el('p', `Problem: ${s.problem}`));
    const unpair = el('button', s.waiting > 0 ? 'Unpair anyway' : 'Unpair');
    unpair.type = 'button';
    unpair.addEventListener('click', () => {
      void peer.unpair().then(() => chrome.action.setBadgeText({ text: '' })).then(() => render('Unpaired'));
    });
    if (s.waiting > 0) {
      app.append(el('p', `${s.waiting} capture(s) have not been sent yet and will be lost if you unpair.`));
    }
    app.append(unpair);
    if (message && message !== 'Paired') app.append(note);
    return;
  }

  const address = el('input');
  address.placeholder = 'https://<your-lector-address>';
  address.autocomplete = 'off';
  const code = el('input');
  code.autocomplete = 'off';
  code.spellcheck = false;
  const pair = el('button', 'Pair');
  pair.type = 'button';
  pair.addEventListener('click', () => {
    const origin = originOf(address.value);
    if (origin === null) return void render('Enter the address of your Lector site.');
    const typed = code.value;
    void (async () => {
      if (!(await grantOrigin(origin))) return void render('Permission for that address was not granted.');
      const r = await peer.pair(origin, typed);
      if (r.ok) return void render('Paired');
      const why: Record<string, string> = {
        format: 'That is not a sync code.',
        checksum: 'The code has a typo. Check it and try again.',
        notFound: 'No sync space found for that code at that address.',
        offline: 'You are offline.',
        relay: 'The relay had a problem. Try again later.',
      };
      void render(why[r.error.kind] ?? 'Pairing failed.');
    })();
  });
  app.append(
    el('p', 'Not paired. Turn on sync in Lector (Settings > Sync), then enter the address of your Lector site and the sync code.'),
    field('Lector address', address),
    field('Sync code', code),
    pair,
    note,
  );
}

void render();
