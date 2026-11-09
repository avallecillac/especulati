# Log articles from your iPhone

Readerlog can't run inside Safari's share sheet, so an iPhone Shortcut reads the article
and opens a **capture link** in Chrome. Readerlog running in Chrome saves the article and
sends it to your other devices through sync.

The Shortcut sends only the address, title, author and word count. The article text is
counted on your phone and never stored or sent.

## One-time setup

### 1. Make Chrome your default browser

Settings → Chrome → Default Browser App → **Chrome**. Shortcuts opens links in the
default browser, so with Safari as the default the capture link would open there instead.

### 2. Pair Readerlog in Chrome on the iPhone

The home-screen app and Chrome keep separate data, so Chrome on the iPhone is one more
sync device.

1. On a device that already syncs, open Readerlog → Settings → Sync → **Show code**.
2. In Chrome on the iPhone, open your Readerlog address.
3. Settings → Sync → **Join**, and paste (or scan) the sync code.

If sync isn't on anywhere yet, turn it on first (Settings → Sync → **Turn on sync**).

### 3. Build the Shortcut

Open the Shortcuts app, tap **+**, and name it **Log in Readerlog**. Add these actions in
order:

1. **Receive** *URLs* input from **Share Sheet** (if there's no input, *Stop and Respond*).
2. **Get Article using Safari Reader** from the *Shortcut Input*. Its output is a blue
   **Article** variable, and the Dictionary in step 5 reads the title, author and word
   count straight from it.

   > **This action is required.** Without it, the values end up read from the
   > *Shortcut Input*, which is just the address: no title, no author, 0 words.
   >
   > **Check the pill icons.** Article values show the Safari Reader icon; Shortcut Input
   > values show the share-sheet icon.
   >
   > **Don't add "Get Details of Articles" actions.** Each new action automatically takes
   > the output of the action just above it, so chained ones read empty values.
3. *(No Count action is needed: the Article has a **Number of Words** property.)*
4. **Current Date**, then **Format Date** with the format **ISO 8601**, and turn on
   **Include ISO 8601 Time** (it's off by default; a date alone is rejected).
5. **Dictionary** with the keys below. Each value except `v` must be a **variable**
   (a blue pill), not typed text: tap the value field, choose **Select Variable**, then
   tap the output you want. Typing `Title` gives the word "Title".

   | Key | Type | Value |
   |---|---|---|
   | `v` | Number | `1` (typed) |
   | `url` | Text | **Shortcut Input** |
   | `title` | Text | **Article** (step 2), then tap the pill and choose **Title** |
   | `author` | Text | **Article**, then tap the pill and choose **Author** |
   | `words` | Number | **Article**, then tap the pill and choose **Number of Words** |
   | `at` | Text | **Formatted Date** (step 4) |
6. *(Optional, to check it once.)* **Show Result** with the **Dictionary**. Share an
   article: you should see its real title, author and a word count above 0. Remove this
   action afterwards.
7. **Base64 Encode** the **Dictionary** (encode, not decode). Pick the Dictionary as its
   input with **Select Variable**, rather than relying on the action above it. Tap **Show More** and set
   **Line Breaks** to **None**: a line break ends the link, so everything after the
   first 76 characters would be lost.
8. **URL Encode** the Base64 text.
9. **Text**. Type `https://<your-readerlog-address>/#/capture?d=`, then, with the cursor
   right after `d=`, insert the output of step 8 as a variable. Don't type its name:
   tap **Select Variable** in the bar above the keyboard (or long-press → **Insert
   Variable**), then tap **URL Encoded Text** in step 8. It appears as a blue pill, with
   no space before it.
10. **Open URLs**, with the **Text** from step 9 as its input.

Then open the Shortcut's settings (the **i** button) and turn on **Show in Share Sheet**,
with **Share Sheet Types** set to **URLs** only.

## Using it

In Chrome (or Safari), tap Share, then **Log in Readerlog**. Chrome opens Readerlog and
shows **Logged: title · site · ~N min**. Tap **Undo** within 6 seconds to remove it. The
article is sent to your other devices straight away; the installed Readerlog app picks it
up the next time it syncs (open it, or tap the sync button).

If the address is already in your log, Readerlog asks whether to **Log again** or
**Cancel**. Opening the same capture link twice never saves twice.

## Troubleshooting

- **The link opens in Safari.** Chrome isn't the default browser (setup step 1).
- **"Finish setup: join your sync space".** Chrome on the iPhone isn't paired yet. The
  article was saved there, and it is sent once you join (setup step 2).
- **"Open URLs failed because Shortcuts couldn't convert from Rich Text to URL".** The
  address was typed straight into *Open URLs*, or the step 8 output wasn't inserted as a
  variable. Build the address in a **Text** action (step 9) and pass that Text to *Open
  URLs* (step 10). To check it, put a **Show Result** before *Open URLs*: it should read
  `https://…/#/capture?d=eyJ…` on one line.
- **"This capture link is damaged".** The screen says which value is wrong. Nothing was saved.
  If the part after `d=` is exactly 76 characters, Base64 Encode still adds line breaks
  (step 7). Check that every Dictionary
  value in step 6 is a blue variable pill (a typed `At` isn't a date), that step 7 is
  *Base64 Encode* and step 8 is *URL Encode*. Use **Add article** to log it by hand.
- **No title, and no reading time, on every article.** Either the *Get Article using
  Safari Reader* action is missing, so the values come from the Shortcut Input (their pills
  show the share-sheet icon), or *Get Details of Articles* actions are chained. Read
  Title, Author and Number of Words from the **Article** variable (setup steps 2 and 5).
- **No reading time (—) on some sites only.** Shortcuts couldn't count the words. Paywalled pages give only a
  preview, because Safari Reader fetches without your cookies. The article is still saved.
- **Sync stopped after a long time unused.** Chrome may have cleared the site's data. Join
  again with your sync code (setup step 2).

## Highlight in Readerlog

A second Shortcut keeps a passage you selected, together with the article, in one go.

### Build it

1. In the Shortcuts app, touch and hold **Log in Readerlog**, then tap **Duplicate**.
2. Open the copy and rename it **Highlight in Readerlog**. It still appears in the Share
   Sheet for **URLs** only.
3. Add **Get Clipboard** right after *Get Article using Safari Reader*.
4. In the **Dictionary**, add one more key: `quote`, type **Text**. For its value tap
   **Select Variable** and choose **Clipboard**. The pill shows the clipboard icon, not
   the share-sheet icon. Leave the other keys as they are.

### Using it

1. In Chrome (or Safari), select the passage and tap **Copy**.
2. Tap Share, then **Highlight in Readerlog**.

Readerlog opens and shows **Highlight saved** with the passage. If the article wasn't in
your log yet, it is logged too. Tap **Add note** to write a note, or **Undo** within 6
seconds to remove the highlight (and the article, if this link just logged it).

The first time, iOS asks whether the Shortcut may paste from other apps. Choose **Always
Allow**, so later runs stay at three taps.

A passage over 5,000 characters isn't saved; the screen says so. Opening the same link
twice never saves twice.

### Troubleshooting

- **"Highlight saved", but the quote is old.** You didn't Copy first. The Shortcut keeps
  whatever was last on the clipboard.
- **The article is logged but nothing is highlighted.** The clipboard was empty, so no
  `quote` was sent. Copy the passage and run it again.
- **"The passage is too long".** Select less text. Nothing was saved.
- **Anything else.** The *Troubleshooting* list above applies too: the rest of the Shortcut
  is the same.

## Save to Readerlog

A third Shortcut keeps an article for later, without counting it as read.

### Build it

1. In the Shortcuts app, touch and hold **Log in Readerlog**, then tap **Duplicate**.
2. Open the copy and rename it **Save to Readerlog**. It still appears in the Share Sheet
   for **URLs** only.
3. In the **Dictionary**, add one more key: `later`, type **Number**, value `1`. Leave the
   other keys as they are.

### Using it

In Chrome (or Safari), tap Share, then **Save to Readerlog**. Readerlog opens and shows
**Saved for later** with the title and site. Tap **Undo** within 6 seconds to remove it.
The article appears in **Library**, under **Saved**, and doesn't change your stats.

If you already read the address, it is saved again and the screen says **You read this on**
the date. If it is already saved, the screen says **Already saved**. Opening the same link
twice never saves twice.

### Troubleshooting

- **It was logged as read, not saved.** The `later` key is missing, or its type isn't
  **Number**. Check the Dictionary.
- **Anything else.** The *Troubleshooting* list above applies too: the rest of the Shortcut
  is the same.
