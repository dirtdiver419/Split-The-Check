# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-10-27

### Added

- More than one payer: mark two or more people as payers and each one enters what they paid plus the tip they added (percent with the usual presets, a dollar amount, or just their card total). Tips are added together and spread by what each person ordered.
- Who pays whom: the results list the payments that settle everyone up, and each slip says who to pay ("Pays Ana $11.89 and Ben $13.67") or what's coming back.
- Payments that don't cover the bill before tip, or cards that don't cover the bill, are flagged with the amount missing.
- Tip by total: a third tip option where you type the total you want to pay and the tip is worked out from it.
- Totals card at the top of the results, with everyone's total, the bill and the payments, plus **Copy totals**.
- Crop and rotate: **Crop and re-read** opens the photo with a draggable crop box and a rotate button, and reads only the cropped part.
- **+ Add an add-on** under each dish, **Make it an add-on of …** to tuck a row under the dish above, and **Make it its own item** to turn an add-on back into a row.
- Discounts field in the tax and tip section, spread by what each person ordered. Discount rows get **Spread over the whole bill**, and the field gets **Make it a line item**. **Add a discount** enters one by hand.
- Undo for a few seconds after removing an item, add-on or person.
- A note at the bottom of the page that it isn't financial advice and totals should be checked against the receipt.
- Version number shown at the bottom of the page.

### Changed

- Add-ons always follow their dish's people. They no longer have their own person buttons; use **Make it its own item** for an add-on that belongs to someone else.
- Discounts are recognized only by a negative amount. One printed right under a dish attaches to it; any other comes in as a row for you to assign or spread.
- Tax and fees are split by what each person owes after discounts; the tip by what they ordered before discounts. Percent tips are calculated on the food total before discounts.
- A plain tip printed on a receipt is only used when the receipt's total shows it was charged. Gratuity and service charges still always count.
- A leading number stays in a dish name unless the receipt prints a quantity column, and the row offers **Split into N?**. The split link now sits next to the price instead of on its own line.
- Reading a new photo, or re-reading a crop, asks first if people are already assigned.

### Fixed

- Dish names with words like "Happy Hour", "Off" or "Comp" were turned into discounts.
- Dish names starting with a number ("7 Layer Dip") lost the number.
- Dishes starting with a percent ("2% Milk", "100% Agave Margarita") were dropped as tip-guide lines.
- Scanning a new receipt kept the previous receipt's tip.
- A message about an unnamed item started with a lowercase letter.
- Discounts printed below the subtotal no longer throw off the subtotal check.

## [2.0.0] - 2026-10-26

A major update to how receipts are read and how items are assigned. The item list layout changed, so this is a new major version.

### Added

- Add-ons such as "-Boiled Egg $2.00" are attached to their dish and go to the same people automatically. Tap **Change** to assign an add-on separately.
- Dish names printed across two lines ("Chicken Katsu" / "Udon") are joined when both lines are clearly the same text size. Joined names are tagged, and **Split apart** undoes the join.
- Joined-name tags turn amber when the items come up short of the subtotal, since that is when a join could have hidden an item.
- Uneven shares: tap **Uneven shares** on any item with two or more people, then use + and − to set shares from 1 to 9. Each person pays their shares divided by the total.
- Quantity recognition for "2 Pizza", "2x Coke", "3 X Taco", "Fries x2" and unit-price lines such as "2 @ 7.50 15.00". **Split into 2** turns one line into separate rows.
- Lines that start with a quantity but lost their price are kept as rows with a blank price instead of being dropped.
- When exactly one item is missing its price, the gap to the subtotal is filled in and marked amber. The split will not calculate until the price is confirmed with **Looks right** or typed in.
- **Add the missing $X** button when the items come up short of the subtotal and no row is missing a price.
- Fees and surcharges (kitchen appreciation, health mandates, card surcharges) are split like tax, by what each person ordered. A fees field appears automatically, or can be added by hand.
- Auto-gratuity on the receipt is filled in as the tip, with a warning not to tip twice.
- Card slips are recognized, with a prompt to photograph the itemized check instead.
- Spelling repair for the reader's i/l mix-ups ("Bolled" → "Boiled", "Terlyaki" → "Teriyaki") using a built-in list of common menu words.
- A misread leading "1" (read as "l", "I" or "il") is removed from item names.
- Shadow and uneven-light correction before reading. If the items don't match the subtotal, the photo is read a second time and the better result is kept.
- Tilt tolerance: text size is compared using the reader's tilt-corrected line heights, measured across the whole page.
- **Copy** button under each person's share, and **Copy everyone's shares**, producing plain text ready to paste into a message.
- Tapping a "Still unclaimed", "needs a price" or "Confirm the guessed price" message scrolls to and highlights that item.
- `noindex, nofollow` tag so search engines don't list the site.
- Test suite expanded to 37 tests, including 20 receipt formats and a real receipt with its measured text sizes.

### Changed

- Item names now use the full width of the screen, with the price on its own line below, so long names are no longer cut off.
- The **Uneven shares** link only appears once two or more people are selected on an item.
- Leading "1 " quantities are removed from item names.
- Slips show shares as "3 of 5" for uneven splits and "÷2" for even ones.

### Fixed

- Subtotals read with a space instead of a decimal point ("$99 25") are now recognized.
- Voided items, tip guide tables ("18% … 20% …"), VAT-included lines and footer promotions are no longer counted as items.
- Fees and surcharges are no longer listed as items that someone has to claim.

## [1.1.0] - 2026-10-03

### Added

- **Paste receipt text**: paste text copied from Google Lens or anywhere else, and it goes through the same reader as photos. Pasted items are added to the list rather than replacing it.
- Text pasted as two columns (all names, then all prices) is paired back up line by line.
- Pressing Enter moves from an item's name to its price, then to the next item, creating a new row at the end of the list.

### Changed

- A blank row left at the end of the list is ignored instead of blocking the split.

## [1.0.0] - 2026-10-03

### Added

- Receipt photo reading on the device using Tesseract.js. Photos are never uploaded.
- People list with a payer, so each share shows who to pay back.
- Tap-to-assign items, with shared plates split evenly between the people selected.
- Tax and tip split in proportion to each person's food and drink total. Tip by percent (15, 18, 20, 22 or custom) or by amount.
- Subtotal check that compares the items against the receipt's subtotal.
- Results shown as one receipt-style slip per person.
- Manual item entry for receipts the reader can't handle.
- Exact money math in whole cents, with leftover pennies distributed so every share adds up to the total.
- Privacy: no database, server, cookies, local storage or IndexedDB. The reader's language-file cache is turned off, and the photo is released as soon as it has been read.
- Security: all code bundled locally with no third-party requests, a strict Content Security Policy, text-only rendering of names and receipt contents, and input limits.
