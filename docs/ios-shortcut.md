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
2. **Get Article using Safari Reader** with the *Shortcut Input* (URL).
3. **Get Details of Articles**: **Title**. Repeat for **Author**, then again for **Body**.
   Keep each result in a variable (for example `Title`, `Author`, `Body`).
4. **Count** the *Body* (type: **Words**). Keep the result as `Words`.
5. **Current Date**, then **Format Date** with the format **ISO 8601**. Keep it as `At`.
6. **Dictionary** with the keys below. Each value except `v` must be a **variable**
   (a blue pill), not typed text: tap the value field, then **Select Variable**, then
   tap the action whose output you want. Typing `Title` gives the word "Title".
   - `v`: a **Number**, `1`
   - `url`: **Text**, the *Shortcut Input*
   - `title`: **Text**, `Title`
   - `author`: **Text**, `Author`
   - `words`: **Number**, `Words`
   - `at`: **Text**, `At`
7. **Base64 Encode** the *Dictionary* (encode, not decode). Line breaks are fine.
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
- **"This capture link is damaged".** Nothing was saved. Check that every Dictionary
  value in step 6 is a blue variable pill (a typed `At` isn't a date), that step 7 is
  *Base64 Encode* and step 8 is *URL Encode*. Use **Add article** to log it by hand.
- **No reading time (—).** Shortcuts couldn't count the words. Paywalled pages give only a
  preview, because Safari Reader fetches without your cookies. The article is still saved.
- **Sync stopped after a long time unused.** Chrome may have cleared the site's data. Join
  again with your sync code (setup step 2).
