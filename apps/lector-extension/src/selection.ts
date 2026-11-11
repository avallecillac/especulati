// Run in the page by chrome.scripting.executeScript({ func: readSelection }) (007 contracts/extension-highlight.md).
// The function is serialised into the page, so it must stay self-contained: no imports, no outer names.
// It returns the user's own selection and nothing else; text typed in a field is not a passage to keep.

/** `getSelection().toString()`, or '' when the selection starts or ends inside an input, textarea or contenteditable. */
export function readSelection(): string {
  const sel = globalThis.getSelection();
  if (!sel || sel.rangeCount === 0) return '';
  const field = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
  for (const node of [sel.anchorNode, sel.focusNode]) {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    if (el?.closest(field)) return '';
  }
  // A selection made with the keyboard inside a focused field leaves the node outside it in some engines.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return '';
  return sel.toString();
}
