# especulati

A monorepo of small, local-first apps that sync end-to-end encrypted through a relay
that only ever sees ciphertext.

| App | What it is | Where |
|---|---|---|
| **Lector** | A personal log of books and web articles, with reading stats (formerly Readerlog) | `apps/lector`, `apps/lector-extension` |
| **Cinéfilo** | A shared movies-and-series tracker for two people (planned: `openspec/changes/add-cinefilo`) | — |

## Lector

A personal, local-first app for logging books and web articles and seeing reading stats.

- **PWA** for the iPhone home screen and for Chrome on the Mac. Data lives in SQLite on each device.
- **Chrome/Brave extension** for one-click "Log as read" on the Mac.
- **iOS Shortcut** that logs articles from Chrome's share sheet on the iPhone.
- **End-to-end-encrypted sync** through a tiny relay that only ever sees ciphertext.

### Install the extension (Chrome or Brave)

1. Build it: `pnpm install && pnpm --filter @especulati/lector-extension build`.
2. Open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode**,
   choose **Load unpacked**, and pick `apps/lector-extension/dist`.
3. Open the extension's **Options**, enter your Lector address, paste the sync code
   (Lector → Settings → Sync → Show code), and choose **Pair**.
4. On an article: click the toolbar icon, press **Alt+Shift+L**, or right-click and
   choose **Log as read**.
5. To keep a passage, select it, then press **Alt+Shift+H** or right-click → **Save
   highlight to Lector**. On the iPhone, see "Highlight in Lector" in
   [the Shortcut guide](docs/ios-shortcut.md).
6. To keep an article for later, press **Alt+Shift+S** or right-click (on a page or a
   link) → **Save for later**. It goes to **Library → Saved**, and logging it later
   marks it read. On the iPhone, see "Save to Lector" in the Shortcut guide.
7. Tag articles on their screen (or **Add tags** right after capturing), then use
   **Library → Search articles** to find them by title, site, tag, or a phrase from your
   highlights and notes.

## Docs

- [Architecture](docs/architecture.md): the current design. The original native-iOS
  spec is kept at [docs/architecture-v1-native-ios.md](docs/architecture-v1-native-ios.md).
- [Log articles from your iPhone](docs/ios-shortcut.md): building the Shortcut and pairing Chrome.
- [Constitution](.specify/memory/constitution.md): Lector's non-negotiable rules.
- [Specs](specs/): Lector features 001–008, written with
  [spec-kit](https://github.com/github/spec-kit). Kept as history.
- [OpenSpec](openspec/): specs and change proposals for all new work.

## Workflow

New work uses [OpenSpec](https://github.com/Fission-AI/OpenSpec):

`/openspec-propose` → review the proposal, design, specs and tasks → `/openspec-apply-change` → `/openspec-archive-change`
