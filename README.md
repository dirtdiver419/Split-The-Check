# Split the check

Take a photo of a restaurant receipt, say who had what, and get each person's share. Tax and tip are divided in proportion to what each person ordered, so the person who had a salad doesn't subsidize the person who had the ribeye.

It runs entirely in the browser. The receipt is read on your own phone or computer by an open-source text reader (Tesseract), so the photo never leaves the device.

## Putting it on GitHub Pages

1. Create a new repository on GitHub (for example `split-the-check`).
2. Upload everything in this folder to the root of the repository, keeping the folder structure. Include the empty `.nojekyll` file.
3. In the repository, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
5. After a minute or two the site is live at `https://<your-username>.github.io/<repo-name>/`.

Add it to your phone's home screen from the browser's share menu so it opens like an app.

## Using it

1. Take or choose a photo of the receipt. Flat, well lit, and filling the frame works best. You can also skip the photo: tap **Type the items in instead**, or **Paste receipt text** to paste text copied from Google Lens or anywhere else. When typing, Enter moves from name to price to the next item.
2. Add everyone at the table and mark who paid.
3. Check the items against the photo and fix anything misread. If the receipt shows a subtotal, the page tells you whether the items add up to it.
4. Tap the people who had each item. Tap several for shared plates; the price is split evenly between them.
5. Confirm the tax and pick a tip. Percent tips are calculated on the pre-tax food and drink total.
6. Screenshot the results.

## What it stores

Nothing.

- No database, no server, no accounts, no analytics, no cookies.
- No `localStorage`, `sessionStorage`, or IndexedDB. The text reader's own language-file cache is switched off (`cacheMethod: 'none'`), which would otherwise save a copy in IndexedDB.
- The photo is held in memory only while you're on the page. The file input is cleared as soon as the photo is read, the working copy of the image is discarded after reading, and the preview is released when you remove the photo, start over, or close the tab.
- Refreshing or closing the page erases everything.

GitHub's servers will log ordinary web requests (IP address, the page files your browser downloads), as any web host does. Your photo and the numbers you type are never part of those requests.

## Security measures

- **No third-party code at runtime.** The text reader and its language data are bundled in `vendor/`, so nothing loads from a CDN that could be compromised or track visitors.
- **Strict Content Security Policy** (in `index.html`): scripts, styles, workers and network requests are limited to this site's own files. Images may come only from this site or from in-memory `blob:` URLs. Forms, plugins, and `<base>` tags are blocked. `'wasm-unsafe-eval'` is allowed because the text reader is WebAssembly; plain JavaScript `eval` stays blocked.
- **No HTML injection.** Item names, people's names and everything read from the receipt are inserted as text, never as HTML, so a receipt line or a name like `<img onerror=...>` shows up as literal characters.
- **Input limits:** 30 people, 150 items, 25 MB photos, amounts capped at $1,000,000, names and item labels length-limited.
- **No referrer** is sent when leaving the page.
- **Exact money math:** all amounts are integer cents. Leftover pennies from splitting are handed out so every share adds up to the exact total.

One limitation: GitHub Pages doesn't let you set HTTP headers, so the `frame-ancestors` protection against being embedded in another site's frame isn't available. The page has no logins or actions worth hijacking, so this is a low risk.

## Files

```
index.html                  page markup and security policy
css/style.css               styles
js/app.js                   interface and scanning
js/split.js                 money parsing and the split math
js/parse.js                 turns receipt text into items, tax and tip
vendor/tesseract/           Tesseract.js 7.0.0 (Apache-2.0)
vendor/tesseract-core/      Tesseract.js-core 7.0.0 WebAssembly builds (Apache-2.0)
vendor/lang/                English language data, 4.0.0_best_int (see NOTICE.txt)
tests/unit.test.mjs         run with `node tests/unit.test.mjs`
```

## Accuracy

The reader handles clean printed receipts well and struggles with crumpled paper, faded thermal ink, glare, and steep angles. Every item and price is editable, and the subtotal check flags misreads, so look over the list before splitting.

## Licenses

Tesseract.js and Tesseract.js-core are Apache-2.0 licensed; their license files are in `vendor/`. The packaged English language data is MIT licensed, built from Tesseract's Apache-2.0 models (see `vendor/lang/NOTICE.txt`).
