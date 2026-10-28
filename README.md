# Split the check

Take a photo of a restaurant receipt, tap who had what, and get each person's share. Tax, tip and fees are divided in proportion to what each person ordered, so the person who had a salad doesn't pay for part of someone else's ribeye.

Everything runs in the browser. The receipt is read on your own phone by an open-source text reader (Tesseract), so the photo never leaves the device, and nothing is saved.

Open the app: https://dirtdiver419.github.io/Split-The-Check/

See [CHANGELOG.md](CHANGELOG.md) for the version history.

## Using it

1. **Receipt.** Take or choose a photo. Flat, well lit and filling the frame works best. You can also tap **Type the items in instead**, or **Paste receipt text** to paste text copied from Google Lens or anywhere else. When typing, Enter moves from name to price to the next item.
2. **People.** Add everyone at the table and mark who paid.
3. **Who had what.** Check the items against the photo and fix anything misread. Tap the people who had each item. Tap several for a shared plate, or **Everyone**. For uneven splits, tap **Uneven shares** and use + and − (Ana 3, Ben 2 means Ana pays 3/5).
4. **Tax and tip.** Confirm the tax and pick a tip. Percent tips are calculated on the food and drink total before tax.
5. **The split.** Screenshot the results, or tap **Copy** under a person's share (or **Copy everyone's shares**) and paste it into a message.

The split won't calculate while something needs attention, such as an unclaimed item or an unconfirmed price. Tap the message under "The split" to jump to the item.

## What the reader handles

- **Subtotal check.** If the receipt prints a subtotal, the page says whether the items add up to it.
- **Add-ons** such as "-Boiled Egg $2.00" are tucked under their dish and go to the same people. Tap **Change** to assign one separately.
- **Two-line dish names** ("Chicken Katsu" / "Udon") are joined only when both lines are clearly the same text size. Joined names are tagged, and **Split apart** undoes it. If the items come up short of the subtotal, the tags turn amber so you check them first.
- **Quantities** ("2 Pizza", "2x Coke", "Fries x2", "2 @ 7.50") are recognized. **Split into 2** turns one line into separate rows.
- **Lost prices.** A line that starts with a quantity but lost its price stays as a row. If exactly one item is missing its price, the gap to the subtotal is filled in and marked amber, and the split waits until you tap **Looks right** or type the price.
- **Lost lines.** If the items come up short, **Add the missing $X** creates a row with that amount for you to name.
- **Fees and surcharges** (kitchen appreciation, health mandates, card surcharges) are split like tax.
- **Auto-gratuity** is filled in as the tip with a warning not to tip twice.
- **Ignored lines:** voided items, tip guide tables, VAT-included lines, payment and change lines. A photo of the card slip instead of the itemized check is flagged.
- **Spelling.** The reader's i/l mix-ups ("Bolled", "Terlyaki") are fixed using a list of common menu words.
- **Difficult photos.** Shadows and uneven light are evened out before reading, and tilted photos are handled. If the items don't match the subtotal, the photo is read a second time and the better result is kept.

The reader still struggles with crumpled paper, badly faded thermal ink, glare and steep angles. Every item and price can be edited, so look over the list before splitting.

## What it stores

Nothing.

- No database, server, accounts, analytics or cookies.
- No `localStorage`, `sessionStorage` or IndexedDB. The text reader's own language-file cache is switched off (`cacheMethod: 'none'`).
- The photo is held in memory only while the page is open. The file input is cleared as soon as the photo is read, working copies of the image are discarded after reading, and the preview is released when you remove the photo, start over or close the tab.
- Refreshing or closing the page erases everything.

The browser keeps the site's own files (about 7 MB, mostly the text reader) in its normal cache, like any website. No receipts, names or amounts are cached. Clearing "Cached images and files" in the browser settings removes them.

GitHub logs ordinary web requests (IP address and the files your browser downloads), as any web host does. Your photo and the numbers you enter are never sent.

## Security

- **No third-party code at runtime.** The text reader and its language data are bundled in `vendor/`, so nothing loads from outside servers.
- **Strict Content Security Policy** (in `index.html`). Scripts, styles, workers and network requests are limited to this site's own files. Images may come only from this site or from in-memory `blob:` URLs. Forms, plugins and `<base>` tags are blocked. `'wasm-unsafe-eval'` is allowed because the text reader is WebAssembly; JavaScript `eval` stays blocked.
- **No HTML injection.** Names and everything read from a receipt are inserted as plain text, so something like `<img onerror=...>` appears as literal characters.
- **Input limits.** 30 people, 150 items, 25 MB photos, amounts up to $1,000,000, length limits on names.
- **Clipboard** is written only when you tap a Copy button and is never read.
- **No referrer** is sent when leaving the page, and a `noindex` tag asks search engines not to list the site.
- **Exact money math.** All amounts are whole cents, and leftover pennies are distributed so every share adds up to the exact total.

GitHub Pages doesn't allow custom HTTP headers, so protection against the page being embedded in another site's frame (`frame-ancestors`) isn't available. The page has no logins or actions worth hijacking, so the risk is low.

## Files

```
index.html                  page markup and security policy
css/style.css               styles
js/app.js                   interface and scanning
js/split.js                 money parsing and the split math
js/parse.js                 turns receipt text into items, add-ons, tax, fees and tip
js/words.js                 menu word list for spelling repairs
vendor/tesseract/           Tesseract.js 7.0.0 (Apache-2.0)
vendor/tesseract-core/      Tesseract.js-core 7.0.0 WebAssembly builds (Apache-2.0)
vendor/lang/                English language data, 4.0.0_best_int (see NOTICE.txt)
tests/unit.test.mjs         37 tests incl. 20 receipt formats: node tests/unit.test.mjs
README.md                   this file
CHANGELOG.md                version history
```

## Third-party components

Tesseract.js and Tesseract.js-core are licensed under Apache-2.0; their license files are in `vendor/`. The packaged English language data is MIT licensed and built from Tesseract's Apache-2.0 models (see `vendor/lang/NOTICE.txt`).

## License

No license is granted for this project's own code. All rights reserved.

---

## AI disclosure and disclaimer

This project was generated with AI. The code, tests and documentation were written by an AI model (Claude, by Anthropic) under the direction of the repository owner, who reviewed and tested the results. AI-generated code can contain errors that aren't obvious, even after testing.

This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the author be liable for any claim, damages or other liability arising from the use of this software.

This tool is not financial advice. Receipt reading can be wrong. Always check the items, prices and totals against the actual receipt before anyone pays.
