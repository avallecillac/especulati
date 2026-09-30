# Feature Specification: Illustrated-Edition UI and Themes

**Feature Branch**: `claude/reader-log-local-first-0bjykj` (spec folder `006-illustrated-edition-ui`)

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "Before spec 006 [export/import], polish the UI. Make the app
feel like a real native iOS app, and look like a beautiful edition of an illustrated
book. Check editions of books like *Cien años de soledad* and *El otoño del patriarca*.
I envision a future where I can have themes."

Export/import, previously numbered 006, becomes **007**.

## Design references

- ***Cien años de soledad*, 50th-anniversary illustrated edition** (Literatura Random
  House, 2017):
  - Luisa Rivera's watercolour, gouache and pencil illustrations: earthy greens and
    blues, ochre oranges, and light picked out with white brushstrokes. Nature motifs
    include rain, golden fish, vegetation and yellow butterflies.
  - Typography: the *Enrico* typeface by Gonzalo García Barcha, with capitals
    hand-worked by the illustrator. There is a drop cap for each chapter, illustrated
    endpapers, and a family tree.
- ***El otoño del patriarca*** (1975; later illustrated and commemorative editions):
  - the tropical decay of a palace;
  - military brass, and the gold of the dictator's medals;
  - night and heat, oxblood and faded gold.
- **What we borrow is the grammar of a fine edition, not its artwork:**
  - a paper tone;
  - a serif text face with true italics and small capitals;
  - drop caps;
  - fleurons and hairline rules;
  - running-head section labels;
  - generous margins;
  - small vignettes.

  Every illustration in the app is **original line art drawn for Readerlog**. No
  artwork, typeface or text from these editions is copied.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - It feels like an iPhone app, not a web page (Priority: P1)

I open Readerlog from my home screen, and nothing gives away that it's a web page.
- Screens have large titles that shrink into the top bar as I scroll.
- The tab bar at the bottom is translucent, with an icon over each label.
- Lists look like iOS grouped lists.
- Sheets slide up with a grabber.
- Buttons respond when I press them.
- Moving into a book slides it in from the right, and going back slides it out.
- Tapping a control never selects text, flashes a grey box, or zooms the page.

**Why this priority**: it's used every day. The feel of the app matters more than its
decoration, and every later theme builds on this shell.

**Independent Test**: on an iPhone (or an iPhone-sized Chromium), open the installed
app, move through Home → Library → a book → back, open the log sheet, then scroll a
long list. Check each native behaviour listed below.

**Acceptance Scenarios**:

1. **Given** any top-level screen, **When** it opens, **Then** its title is shown large
   at the top of the content. **When** I scroll down past it, **Then** a compact title
   appears centred in the top bar.
2. **Given** the tab bar, **Then** it shows an icon and a label for each tab. The
   current tab is tinted with the theme's accent, and content scrolling behind it is
   visible through a blurred, translucent background.
3. **Given** a detail screen (a book, an article, Sync, Duplicates), **Then** the top
   bar shows a back control labelled with the parent screen, which returns there.
4. **Given** I move from a list into a detail screen, **Then** the detail slides in
   from the right. Going back reverses it. With *Reduce Motion* on, screens cross-fade
   instead.
5. **Given** a sheet (Log progress, confirmations), **Then** it rises from the bottom
   with a grabber and rounded top corners, and the screen behind it dims.
6. **Given** I tap any button, row or tab, **Then** it gives visible press feedback
   within the tap. No grey tap highlight appears, no text is selected, and no
   long-press callout appears on controls.
7. **Given** I focus a text field, **Then** the page does not zoom.
8. **Given** the app is installed, **Then** content respects the notch and home
   indicator. The status bar area matches the theme.

---

### User Story 2 - It looks like a fine illustrated edition (Priority: P1)

The app reads like a beautifully made book:
- warm paper, dark ink, and serif type set with care;
- each screen opens like a chapter, with a drop cap or a fleuron;
- section labels read like running heads in small capitals;
- rules are fine hairlines;
- small line-drawn vignettes (yellow butterflies, a leaf, a fish) appear where the
  page would otherwise be empty.

**Why this priority**: it's what the user asked for, and it makes the app a pleasure to
open.

**Independent Test**: open each screen in the default theme and compare it with the
design references and the visual checklist in the plan.

**Acceptance Scenarios**:

1. **Given** any screen, **Then** body text and titles use the edition's serif text
   face. Numbers in stats use old-style or tabular figures, as fits.
2. **Given** the Home screen's current book, **Then** its title is set like a chapter
   opening: a drop cap, the title in the display face, and the author in small
   capitals.
3. **Given** a section heading (for example "This year", "Sync"), **Then** it is set in
   letter-spaced small capitals between hairline rules or with a fleuron, like a
   running head.
4. **Given** an empty state (no books, no articles, no stats yet), **Then** a small
   line-drawn vignette and a short line of text fill the space.
5. **Given** a book with no cover, **Then** its generated cover looks like a cloth
   binding: a theme colour, a title label and a simple ornament.
6. **Given** the Stats heatmap, **Then** its colour scale uses the theme's palette, and
   every level stays distinguishable.
7. **Given** a long title, author or site, **Then** nothing overflows the screen at
   320 px wide.

---

### User Story 3 - Choose a theme (Priority: P2)

In Settings → Appearance I can choose **Macondo** (light), **Patriarca** (dark) or
**Automatic** (follows the phone's light/dark setting). The app changes immediately,
and the choice stays on this device.

**Why this priority**: the user wants themes in the future. Two themes, plus the system
option, prove that the theme system works.

**Independent Test**: switch between the three options, reload, and check the choice
persists. Change the system appearance while on *Automatic*.

**Acceptance Scenarios**:

1. **Given** Settings → Appearance, **Then** it lists Automatic, Macondo and Patriarca,
   each with a small preview swatch, and a check mark on the current one.
2. **Given** I pick Patriarca, **Then** every screen switches at once, with no reload,
   to the dark night, oxblood and gold palette.
3. **Given** I reload or reopen the app, **Then** the chosen theme is applied before
   anything is drawn, with no flash of the other theme.
4. **Given** Automatic, **When** the phone switches between light and dark, **Then**
   the app follows: Macondo by day, Patriarca by night.
5. **Given** another device synced with this one, **Then** its theme is unaffected
   (the choice is per device).

---

### User Story 4 - Adding a theme later is only a palette (Priority: P3)

As the maintainer, I can add a new theme (for example "Otoño", or "Mariposas amarillas")
by defining one set of named design values and registering its name. I don't need to
touch any screen.

**Why this priority**: it's a future requirement that shapes the design now, but it
has no user-visible change today.

**Independent Test**: add a throwaway test theme in a test, and check that every screen
renders with it and that no screen hard-codes a colour.

**Acceptance Scenarios**:

1. **Given** the list of design values a theme defines, **Then** it is documented in
   one place, and every theme defines all of them.
2. **Given** the screens, **Then** none uses a literal colour, font or radius outside
   the theme definitions (checked automatically). The exceptions are the QR code's
   black on white and the camera view.

### Edge Cases

- **The fonts haven't loaded yet, or the device is offline on first run.** The fonts
  ship with the app and work offline. Until they load, a similar serif fallback is
  used, and the layout doesn't jump.
- **Dynamic Type or browser zoom at 200%.** Text reflows. Nothing is clipped, and
  controls stay at least 44 × 44 pt.
- **Reduce Motion.** Transitions become cross-fades, and nothing animates
  continuously.
- **Reduce Transparency, or a browser without backdrop blur.** Bars become solid.
- **Contrast.** Body text and controls meet WCAG AA in both themes (4.5:1 for text,
  3:1 for large text and UI graphics).
- **The Mac (Chrome, wide window).** The same edition look is used, centred in a
  readable column. Native iOS behaviours such as gestures degrade gracefully.
- **Scanner and QR views.** They keep their functional colours (a black camera view,
  and a black-on-white QR code) in every theme.
- **The page behind a sheet.** It doesn't scroll while the sheet is open.
- **Long lists, such as 5,000 articles.** Scrolling stays smooth, with no heavy effects
  per row.

## Requirements *(mandatory)*

### Functional Requirements

**Native shell (US1)**

- **FR-001**: Top-level screens (Home, Library, Add, Stats, Settings) MUST show a large
  title that collapses into a compact title in the top bar on scroll.
- **FR-002**: Detail screens MUST show a back control naming the parent screen, and it
  MUST return there.
- **FR-003**: The tab bar MUST show an icon and a label per tab, tint the current tab,
  and be translucent with a blur, or solid where blur is unavailable or Reduce
  Transparency is on.
- **FR-004**: Moving to a detail screen and back MUST use a horizontal push/pop
  transition. Tab switches MUST NOT slide. Reduce Motion MUST give cross-fades.
- **FR-005**: Sheets MUST rise from the bottom with a grabber and a dimmed backdrop,
  and the content behind them MUST NOT scroll.
- **FR-006**: Every tappable element MUST show press feedback. Controls MUST NOT show a
  tap highlight, select text or show a long-press callout. Text fields MUST NOT cause
  zoom on focus.
- **FR-007**: Layout MUST respect all safe-area insets. The status bar and theme colour
  MUST match the active theme.
- **FR-008**: Lists of books, articles, settings and history MUST be shown as inset
  grouped lists: rounded groups with hairline separators and disclosure chevrons on
  rows that navigate.

**Edition look (US2)**

- **FR-009**: The app MUST ship its text fonts with the app so they work offline: a
  serif text face with italics, small capitals and old-style figures, plus a display
  face for titles. The fonts MUST be under open licences.
- **FR-010**: Section headings MUST be styled as running heads (small capitals,
  letter-spaced, with hairline rules or a fleuron).
- **FR-011**: The current book on Home and the book screen's title MUST use a
  chapter-opening treatment: a drop cap or display title, and the author in small
  capitals.
- **FR-012**: Empty states on Home, Library (books and articles) and Stats MUST show an
  original line-drawn vignette with a short line of text.
- **FR-013**: Generated covers MUST look like cloth bindings in theme colours, with a
  label and an ornament. Real covers are unchanged.
- **FR-014**: The heatmap and the other stats visuals MUST take their colours from the
  theme.
- **FR-015**: All ornaments and vignettes MUST be original SVG artwork, take their
  colour from the theme, and be decorative only (hidden from assistive technology).

**Themes (US3, US4)**

- **FR-016**: Settings MUST have an Appearance section offering Automatic, Macondo and
  Patriarca, each with a preview swatch.
- **FR-017**: The theme choice MUST apply immediately, persist on this device only, be
  applied before first paint on launch, and MUST NOT be synced.
- **FR-018**: Automatic MUST follow the system appearance live.
- **FR-019**: A theme MUST be defined entirely by one documented set of named design
  values (colours, fonts, radii, shadows, ornament colours). Adding a theme MUST need
  no screen changes.
- **FR-020**: An automated check MUST fail if a screen uses a literal colour outside
  the theme definitions, apart from the documented exceptions (QR, camera).

**No regressions**

- **FR-021**: Every existing flow, route, accessible name and label MUST keep working,
  and all existing automated tests MUST pass unchanged, apart from this spec's one
  label change.
- **FR-022**: The Settings Sync card's button MUST read **"Sync settings"**, because
  "Sync" read as a sync-now action.
- **FR-023**: Primary capture flows MUST NOT gain any tap (constitution V).

### Key Entities

- **Theme**: a named palette and type set (id, display name, light or dark, and the
  full set of design values). It is a static app definition, not user data.
- **Appearance preference**: `automatic | <theme id>`. It is stored on this device
  only, and never synced or exported.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On an iPhone home-screen install, a first-time viewer can't point to a
  web-page artefact in a 2-minute walkthrough. Checked by the user on the device.
- **SC-002**: All existing automated flows pass unchanged. Every screen passes an
  automated accessibility scan with no serious or critical issues in both themes.
- **SC-003**: Text contrast is at least 4.5:1 (AA) for body text in both themes,
  verified for every text/background pair in the theme definitions.
- **SC-004**: Switching theme updates the whole app within 100 ms, and a relaunch shows
  no flash of the wrong theme.
- **SC-005**: A new theme can be added by editing only the theme definitions and the
  theme registry, as shown by a test theme that renders every screen.
- **SC-006**: The app stays fast: the local write-to-screen time stays under 100 ms,
  the stats screen renders under 200 ms (constitution), and the added fonts and
  artwork add under 400 KB to the first load.
- **SC-007**: No layout overflows at 320 px wide, or at 200% text size, on any screen.

## Assumptions

- **No clarification was possible** (the user was away). Decisions were made from the
  brief:
  - two themes plus Automatic;
  - Macondo is the default;
  - the theme choice is per device.
- **Fonts:** open-licence (SIL OFL) serif families are bundled, because Enrico is
  proprietary. The candidates are EB Garamond, Cormorant and Spectral, chosen in
  research. The fonts are self-hosted and precached for offline use.
- **"Native" means iOS conventions rendered by the web app.** It's not a native
  rebuild: there's no Apple developer account (constitution: technical constraints).
  Interactive swipe-back is out of scope; iOS's own edge-swipe does nothing in a
  standalone PWA with hash routing. The back control is the way back.
- **No data or schema change.**
- **Articles and books keep their current information architecture.** Only the
  presentation changes.
- **The Mac extension's small UI** (the toast and the options page) is out of scope for
  this feature. It may adopt the look later.
