// Service worker (contracts/extension.md): the action, the shortcut and the context menu all end in
// captureTab(). It keeps no state in memory across events: every choice a toast offers comes back
// as a message that carries what it needs, so the worker may be stopped in between.
import { normalizeQuote, normalizeUrl, readingMinutes, siteOf } from '@especulati/lector-core';
import { createCapturePeer } from '@especulati/lector-sync/capturePeer';
import type { Extracted } from './extract.ts';
import { readSelection } from './selection.ts';
import { chromeStore } from './store.ts';
import type { CapturePayload, ToastState } from './toast.ts';

const UNDO_MS = 6000;
const MENU_ID = 'log-as-read';
const HIGHLIGHT_ID = 'save-highlight';
const SAVE_ID = 'save-later';
const SAVE_COMMAND = 'save-for-later';
const ALARM = 'lector-flush';

export const peer = createCapturePeer(chromeStore, {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  online: () => navigator.onLine,
});

declare const __E2E__: boolean;

type Tab = Pick<chrome.tabs.Tab, 'id' | 'url'>;

/** The local date of the browser, computed here in the shell. */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function updateBadge(): Promise<void> {
  const { waiting } = await peer.status();
  await chrome.action.setBadgeText({ text: waiting > 0 ? String(waiting) : '' });
}

/** Feedback for a page that can't be captured, with no toast (nothing can be injected there). */
async function refuse(): Promise<void> {
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setTitle({ title: "Can't log this page" });
  setTimeout(() => {
    void chrome.action.setTitle({ title: 'Log as read' });
    void updateBadge();
  }, 3000);
}

async function showToast(tabId: number, state: ToastState): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['toast.js'] });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (s: ToastState) => (globalThis as { __lectorToast?: (x: ToastState) => void }).__lectorToast?.(s),
      args: [state],
    });
  } catch {
    // The tab went away or navigated: nothing to show.
  }
}

async function extract(tabId: number): Promise<Extracted | null> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as { __lectorExtract?: () => Extracted }).__lectorExtract?.() ?? null,
    });
    return res?.result ?? null;
  } catch {
    return null;
  }
}

/** Run the capture for a payload and show what happened. `force` is Log again. */
async function log(tabId: number, capture: CapturePayload, force: boolean): Promise<void> {
  const r = await peer.capture({ ...capture, force });
  await updateBadge();
  // The ops are stored: send them in the background so the toast never waits for the relay.
  if (r.ok && !r.value.duplicateOf) void flush();
  if (!r.ok) {
    if (r.error === 'notPaired') {
      await showToast(tabId, { kind: 'error', message: 'Lector is not paired. Open the extension options.' });
      void chrome.runtime.openOptionsPage();
    } else {
      await showToast(tabId, { kind: 'error', message: "Couldn't log this page" });
    }
    return;
  }
  if (r.value.duplicateOf) {
    await showToast(tabId, { kind: 'duplicate', title: capture.title, readOn: r.value.duplicateOf.readOn, capture });
    return;
  }
  const url = normalizeUrl(capture.url);
  await showToast(tabId, {
    kind: 'logged',
    title: capture.title,
    site: url.ok ? siteOf(url.value) : '',
    minutes: readingMinutes(capture.words),
    itemId: r.value.itemId,
    undoMs: UNDO_MS,
  });
}

/** Capture the page in `tab` (the toolbar action, the shortcut and the context menu all land here). */
export async function captureTab(tab: Tab | undefined): Promise<void> {
  if (!tab || tab.id === undefined || !/^https?:\/\//i.test(tab.url ?? '')) return refuse();
  const tabId = tab.id;
  const found = await extract(tabId);
  if (!found) return showToast(tabId, { kind: 'error', message: "Couldn't read this page" });
  const now = new Date();
  await log(tabId, { ...found, at: now.toISOString(), readOn: localDate(now) }, false);
}

/** 008: save the page in `tab` (or, with `linkUrl`, the address alone) for later. */
export async function saveTab(tab: Tab | undefined, linkUrl?: string): Promise<void> {
  const tabId = tab?.id;
  const at = new Date().toISOString();
  let input: { url: string; title: string; author: string | null; words: number | null; at: string; detailsStatus?: 'complete' | 'notFound' };
  if (linkUrl !== undefined && linkUrl !== '') {
    // A link: the page is not loaded, so only the address is saved, with the site as its title.
    const url = /^https?:\/\//i.test(linkUrl) ? normalizeUrl(linkUrl) : null;
    if (!url || !url.ok) return tabId === undefined ? undefined : showToast(tabId, { kind: 'error', message: "Can't save this link" });
    input = { url: linkUrl, title: siteOf(url.value), author: null, words: null, at, detailsStatus: 'notFound' };
  } else {
    if (!tab || tabId === undefined || !/^https?:\/\//i.test(tab.url ?? '')) return refuse();
    const found = await extract(tabId);
    if (!found) return showToast(tabId, { kind: 'error', message: "Couldn't read this page" });
    input = { ...found, at };
  }
  const r = await peer.save(input);
  await updateBadge();
  if (!r.ok) {
    if (tabId === undefined) return;
    if (r.error === 'notPaired') {
      await showToast(tabId, { kind: 'error', message: 'Lector is not paired. Open the extension options.' });
      void chrome.runtime.openOptionsPage();
    } else {
      await showToast(tabId, { kind: 'error', message: "Couldn't save this page" });
    }
    return;
  }
  if (!r.value.alreadySaved) void flush();
  if (tabId === undefined) return;
  const url = normalizeUrl(input.url);
  await showToast(
    tabId,
    r.value.alreadySaved
      ? { kind: 'alreadySaved', title: input.title }
      : { kind: 'saved', title: input.title, site: url.ok ? siteOf(url.value) : '', itemId: r.value.itemId, undoMs: UNDO_MS },
  );
}

/** Why a stored op was refused, as a toast. Never includes the quote or note. */
async function showPeerError(tabId: number, error: 'notPaired' | 'invalid' | 'tooLong'): Promise<void> {
  if (error === 'notPaired') {
    await showToast(tabId, { kind: 'error', message: 'Lector is not paired. Open the extension options.' });
    void chrome.runtime.openOptionsPage();
  } else if (error === 'tooLong') {
    await showToast(tabId, { kind: 'error', message: 'That passage is too long (5,000 characters max)' });
  } else {
    await showToast(tabId, { kind: 'error', message: "Couldn't save this highlight" });
  }
}

/** The page's selection; `fallback` (the context menu's own copy) only when the page can't be read. */
async function selectionOf(tabId: number, fallback: string | undefined): Promise<string> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readSelection });
    return typeof res?.result === 'string' ? res.result : '';
  } catch {
    return fallback ?? '';
  }
}

/**
 * Save the selection of `tab` as a highlight (007). The article is logged first when this page is not
 * yet in `captured`, and Undo then removes both.
 */
export async function highlightTab(tab: Tab | undefined, selectionText?: string): Promise<void> {
  if (!tab || tab.id === undefined || !/^https?:\/\//i.test(tab.url ?? '')) return refuse();
  const tabId = tab.id;
  const raw = await selectionOf(tabId, selectionText);
  const quote = normalizeQuote(raw);
  if (!quote.ok) return showToast(tabId, { kind: 'error', message: 'That passage is too long (5,000 characters max)' });
  if (quote.value === null) return showToast(tabId, { kind: 'error', message: 'Select some text to highlight' });

  const url = normalizeUrl(tab.url!);
  if (!url.ok) return refuse();
  const captured = (await chromeStore.get<Record<string, { itemId: string; removed: boolean }>>('captured')) ?? {};
  const known = captured[url.value];
  let itemId: string;
  let createdArticle = false;
  if (known && !known.removed) {
    itemId = known.itemId;
  } else {
    const found = await extract(tabId);
    if (!found) return showToast(tabId, { kind: 'error', message: "Couldn't read this page" });
    const now = new Date();
    const c = await peer.capture({ ...found, at: now.toISOString(), readOn: localDate(now), force: true });
    if (!c.ok) return showPeerError(tabId, c.error);
    itemId = c.value.itemId;
    createdArticle = true;
  }
  const at = new Date();
  const h = await peer.highlight({ itemId, quote: quote.value, at: at.toISOString(), localDate: localDate(at) });
  await updateBadge();
  if (!h.ok) return showPeerError(tabId, h.error);
  // The ops are stored: send them in the background so the toast never waits for the relay.
  void flush();
  await showToast(tabId, { kind: 'highlighted', highlightId: h.value.highlightId, itemId, createdArticle, undoMs: UNDO_MS });
}

export async function flush(): Promise<void> {
  await peer.flush();
  await updateBadge();
}

/** The short result of Add tags. Never includes a tag name. */
function tagsMessage(added: number, dropped: number): string {
  const n = `${added} ${added === 1 ? 'tag' : 'tags'} added`;
  if (added === 0) return dropped > 0 ? `No tags added (${dropped} skipped)` : 'No tags added';
  return dropped > 0 ? `${n}, ${dropped} skipped` : n;
}

async function onMessage(msg: unknown, tabId: number | undefined): Promise<void> {
  const m = msg as { type?: string; text?: unknown; itemId?: unknown; capture?: CapturePayload; highlightId?: unknown; createdArticle?: unknown; note?: unknown };
  if (m.type === 'undo' && typeof m.itemId === 'string') {
    await peer.undo(m.itemId);
    await updateBadge();
    void flush();
    if (tabId !== undefined) await showToast(tabId, { kind: 'undone' });
  } else if (m.type === 'undoHighlight' && typeof m.highlightId === 'string') {
    await peer.undoHighlight(m.highlightId);
    if (m.createdArticle === true && typeof m.itemId === 'string') await peer.undo(m.itemId);
    await updateBadge();
    void flush();
    if (tabId !== undefined) await showToast(tabId, { kind: 'undone' });
  } else if (m.type === 'editNote' && typeof m.highlightId === 'string' && typeof m.note === 'string') {
    const r = await peer.editNote(m.highlightId, m.note);
    await updateBadge();
    if (r.ok) void flush();
    if (tabId !== undefined) {
      await showToast(tabId, r.ok ? { kind: 'noteSaved' } : { kind: 'error', message: r.error === 'tooLong' ? 'That note is too long (5,000 characters max)' : "Couldn't save the note" });
    }
  } else if (m.type === 'addTags' && typeof m.itemId === 'string' && typeof m.text === 'string') {
    const names = m.text.split(/[,，]/).map((x) => x.trim()).filter((x) => x !== '');
    const r = names.length === 0 ? null : await peer.tag(m.itemId, names);
    await updateBadge();
    if (r?.ok) void flush();
    if (tabId !== undefined && r) {
      await showToast(tabId, r.ok ? { kind: 'tagsAdded', message: tagsMessage(r.value.added, r.value.dropped) } : { kind: 'error', message: "Couldn't add tags" });
    }
  } else if (m.type === 'logAgain' && m.capture && tabId !== undefined) {
    await log(tabId, m.capture, true);
  }
}

export const onCommand = (command: string, tab?: Tab): Promise<void> | void =>
  command === MENU_ID ? captureTab(tab) : command === HIGHLIGHT_ID ? highlightTab(tab) : command === SAVE_COMMAND ? saveTab(tab) : undefined;
export const onMenuClick = (
  info: { menuItemId: string | number; selectionText?: string | undefined; linkUrl?: string | undefined },
  tab?: Tab,
): Promise<void> | void =>
  info.menuItemId === MENU_ID
    ? captureTab(tab)
    : info.menuItemId === HIGHLIGHT_ID
      ? highlightTab(tab, info.selectionText)
      : info.menuItemId === SAVE_ID
        ? saveTab(tab, info.linkUrl)
        : undefined;

chrome.action.onClicked.addListener((tab) => void captureTab(tab));
chrome.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
chrome.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  void onMessage(msg, sender.tab?.id).then(() => sendResponse(true));
  return true;
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void flush();
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Log as read', contexts: ['page', 'action'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: SAVE_ID, title: 'Save for later', contexts: ['page', 'link'] }, () => void chrome.runtime.lastError);
  chrome.contextMenus.create({ id: HIGHLIGHT_ID, title: 'Save highlight to Lector', contexts: ['selection'] }, () => void chrome.runtime.lastError);
  void chrome.alarms.create(ALARM, { periodInMinutes: 5 });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(ALARM, { periodInMinutes: 5 });
  void flush();
});

// Handles for the e2e fixture, which cannot click the toolbar or grant activeTab headlessly.
// Only in the EXT_E2E build: `__E2E__` is a build-time constant, so the release bundle has none of this.
if (__E2E__) {
  (globalThis as { lector?: unknown }).lector = { captureTab, onCommand, onMenuClick, flush, status: () => peer.status() };
}
