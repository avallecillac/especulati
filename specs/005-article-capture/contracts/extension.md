# Contract: Chrome/Brave extension (`apps/extension`)

## Manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "Readerlog",
  "version": "0.1.0",
  "action": { "default_title": "Log as read" },
  "background": { "service_worker": "sw.js", "type": "module" },
  "permissions": ["activeTab", "scripting", "contextMenus", "storage", "alarms"],
  "optional_host_permissions": ["https://*/*"],
  "commands": { "log-as-read": { "suggested_key": { "default": "Alt+Shift+L" }, "description": "Log this page as read" } },
  "options_page": "options.html"
}
```

It has no `host_permissions`, no content scripts declared for all sites, and no remote
code.

## Modules

| Module | Role |
|---|---|
| `src/extract.ts` | `extractPage(): { url, title, author, words }`, run in the page by `chrome.scripting.executeScript`. It uses Readability and `Intl.Segmenter` (research R4). It is pure DOM and makes no network calls |
| `src/toast.ts` | Injected UI in a shadow DOM: logged, already logged, error, and Undo. It messages the service worker |
| `src/sw.ts` | Handles the action click, the command and the context menu. It calls `capture(tab)`, and runs push-only when captures are waiting and on `chrome.runtime.onStartup` |
| `src/store.ts` | `CaptureStore` over `chrome.storage.local` |
| `src/options.ts` | Pairing: the app origin plus the sync code. It shows status and offers Unpair |

## Capture sequence

1. A trigger gives an `activeTab`.
   - A non-`http(s)` URL sets a "!" badge for 3 s and the action title "Can't log this
     page". There's no `notifications` permission.
2. `executeScript(extractPage)` returns the details.
   - An error shows the toast "Couldn't read this page". Nothing is saved.
3. The URL is normalized, and the `captured[url]` entry is looked up.
   - If there's a live entry, the toast shows "Already logged on <date>" with **Log
     again** or **Cancel**, and the sequence waits for the choice.
4. `decide(null, AddArticle{ itemId: uuidFromHash("readerlog-capture-v1|"+url+"|"+at), … })`,
   then `stampOps`, then append to `pending`, and save `captured[url]`.
5. The toast shows "Logged · <site> · ~N min" with **Undo** for 6 s, **straight away**:
   `capture()` returns once the ops are stored, without waiting for the relay. The
   badge shows the number waiting.
6. A push-only run follows in the background.
   - Offline or a relay failure: the ops stay in `pending`, and a retry happens on the
     next capture, on startup, and on a `chrome.alarms` tick every 5 minutes (this
     needs the `alarms` permission).
7. **Undo**: `RemoveArticle` is stamped, appended, and a push-only run follows.
   `captured[url].removed = true`.

## Capture peer (`packages/sync/src/capturePeer.ts`)

```ts
interface CaptureStore { get<T>(k: string): Promise<T | undefined>; set(patch: Record<string, unknown>): Promise<void> }
function createCapturePeer(store: CaptureStore, deps: { fetch; now; random; online }): {
  pair(appOrigin: string, code: string): Promise<Result<void, SyncError>>;   // parseSyncCode + GET /spaces/:id
  unpair(): Promise<void>;
  capture(p: { url: string; title: string; author: string | null; words: number | null; at: string; readOn: string; force?: boolean }):   // force = Log again
    Promise<Result<{ itemId: string; duplicateOf?: { readOn: string } }, 'notPaired' | 'invalid'>>;
  undo(itemId: string): Promise<void>;
  flush(): Promise<{ sent: number; problem: SyncProblem | null }>;           // push-only; never GET /batches
  status(): Promise<{ paired: boolean; waiting: number; lastSentAt: string | null; problem: SyncProblem | null }>;
};
```

- **Import rule**: `capturePeer.ts` MUST NOT import `packages/db` or `engine.ts`. It is
  imported by a subpath, so the extension bundle contains no SQLite.
- **Shared push**: the batching and idempotent-retry logic is shared with the 004
  engine through `packages/sync/src/push.ts`.

## Build-time rules

- **Test hooks**: `globalThis.readerlog` (the e2e handles) exists only in the `EXT_E2E=1`
  build. The release `build` fails if `dist/sw.js` contains them.
- **Minimum article size**: Readability text shorter than `MIN_ARTICLE_WORDS = 25` gives
  `words: null`. This is how pages with no article, such as product grids, are detected.

## Relay access

- The extension calls `https://<appOrigin>/api/v1/...` only, after the user grants that
  one origin at pairing.
- The same auth and encryption as feature 004 apply.
