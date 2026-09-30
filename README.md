# Readerlog

A personal, local-first app for logging books and web articles and seeing reading stats.

- **PWA** for the iPhone home screen and for Chrome on the Mac. Data lives in SQLite on each device.
- **Chrome extension** for one-click "Log as read" on the Mac.
- **iOS Shortcut** that logs articles from Safari's share sheet.
- **End-to-end-encrypted sync** through a tiny relay that only ever sees ciphertext.

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
