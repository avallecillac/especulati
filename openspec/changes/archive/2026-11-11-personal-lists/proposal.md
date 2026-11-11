## Why

Cinéfilo has one list the two of us share. We also watch on our own, especially series, and want to track that without cluttering the shared list. Each of us should see what the other is watching or has watched, and always know whose list is on screen.

## What Changes

- **Three lists over one catalog:** Together (the current shared list, unchanged and the default), Mine, and the partner's. A title exists once; each list is a status on it (Watch later / Watching / Watched, season, watched date).
- **Personal statuses are single-writer:** only I change my list; my partner sees it read-only. Like ratings, two devices never overwrite each other.
- **A list switch** above the tabs (`Together · <me> · <partner>`), opening on Together. The partner's list is clearly marked as theirs and view-only.
- **Add to:** the add sheet asks "Together" or "Just me", defaulting to the list on screen.
- **The title screen** shows all three statuses (Together, mine, partner's) and lets me set mine.
- **Recommend:** from a title on my list, "Recommend to <partner>" puts it on the partner's list as a recommendation ("Recommended by <me>") until they accept it (adding it to their own Watch later or marking it watched) or dismiss it.
- **Series:** each person tracks their own season on their list, separate from the Together season.
- Watching something solo never changes its Together status.
- Export and import include personal statuses and recommendations.

Out of scope: private (hidden) personal entries, notifications, per-list filters beyond the existing verdict chips, statistics.

## Rollout

The change is built on the `personal-lists` branch and reviewed on a Cloudflare preview deployment. It is not merged to `main` (production) until the user says so.

## Capabilities

### New Capabilities
- `cinefilo-personal-lists`: personal statuses, the list switch, recommendations.

### Modified Capabilities
- None. The Together list keeps every `cinefilo-watchlist` requirement as it is.

## Impact

`cinefilo-core` (new tables in the allow-list, commands, rejections, a new batch tier), `cinefilo-db` (migration 2, read models, export/import), the worker protocol, List, TitleScreen, AddSheet, App shell. Older app versions skip the new tier and catch up after updating (cursor reset in migration 2).
