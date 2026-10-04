# Readerlog

A personal, local-first app for logging books and web articles and seeing reading stats.

- **PWA** for the iPhone home screen and for Chrome on the Mac. Data lives in SQLite on each device.
- **Chrome/Brave extension** for one-click "Log as read" on the Mac.
- **iOS Shortcut** that logs articles from Chrome's share sheet on the iPhone.
- **End-to-end-encrypted sync** through a tiny relay that only ever sees ciphertext.

## Install the extension (Chrome or Brave)

1. Build it: `pnpm install && pnpm --filter @readerlog/extension build`.
2. Open `chrome://extensions` (or `brave://extensions`), turn on **Developer mode**,
   choose **Load unpacked**, and pick `apps/extension/dist`.
3. Open the extension's **Options**, enter your Readerlog address, paste the sync code
   (Readerlog → Settings → Sync → Show code), and choose **Pair**.
4. On an article: click the toolbar icon, press **Alt+Shift+L**, or right-click and
   choose **Log as read**.
5. To keep a passage, select it, then press **Alt+Shift+H** or right-click → **Save
   highlight to Readerlog**. On the iPhone, see "Highlight in Readerlog" in
   [the Shortcut guide](docs/ios-shortcut.md).

## Docs

- [Architecture](docs/architecture.md): the current design. The original native-iOS
  spec is kept at [docs/architecture-v1-native-ios.md](docs/architecture-v1-native-ios.md).
- [Log articles from your iPhone](docs/ios-shortcut.md): building the Shortcut and pairing Chrome.
- [Constitution](.specify/memory/constitution.md): the project's non-negotiable rules.
- [Specs](specs/): one folder per feature, written with
  [spec-kit](https://github.com/github/spec-kit).

## Workflow

Every feature goes through the spec-kit skills in this order:

`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`
