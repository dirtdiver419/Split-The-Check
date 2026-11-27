# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.10.2] - 2026-11-27

### Changed

- Photos framed in the crop screen are not straightened again while reading. The sample bill still is.
- The payer button's spoken name is its text plus the person's name, like "Mark as payer, Ben" or "Paid, Ben". It no longer reports a pressed state.
- Tab and Shift+Tab stay inside the crop screen while it is open.
- The sample receipt names its server.

### Fixed

- "Tender", "cash" and "change" are payment words only below the subtotal. "Tendered" is a payment word anywhere.
- "Before Tax", "Pre-tax" and "Excl. tax" lines are read as the subtotal, not as tax.
- A price followed by up to three stray marks is read.
- Lines that start with a quantity and a bracketed dish number, like "1 (2)", count as quantity lines.
- On receipts that print quantities, a priced line with no quantity right under a dish with no price is joined to that dish, and the dish gets the price. **Split apart** puts the price back on the second line.
- On receipts that print quantities, a lone "I" or "l" before "(" at the start of a line is read as a quantity of 1.
- A tax percent written with a decimal comma is left out of the tax name.

## [2.10.1] - 2026-11-23

### Added

- Magnifier while dragging a crop corner. It shows the corner at 2.5× above the finger or pointer, or below it near the top of the photo area.

### Changed

- Crop screen gestures. Dragging moves the photo under the box, pinch and scroll zoom it, and the corners resize the box.
- Releasing a corner moves the box back to the middle and zooms the photo to fill the space.
- Panning stops at the photo's edge.
- Zoom changes what the box frames. **Fit** goes back to the whole photo.
- The crop screen fits the screen without scrolling. The note was removed, **↻** moved to the start of the Straighten row, and **+ / Fit / −** float on the right edge of the photo area. The zoom buttons are hidden while a corner is dragged.
- Straighten range widened from ±15° to ±45°. Automatic straightening still stops at 15°.
- A turned photo is drawn in a frame large enough to hold all of it.
- Crop corners stay at least 24 px inside the photo area when settled.

## [2.10.0] - 2026-11-21

### Added

- Zoom in the crop screen, up to 4×, with pinch, the scroll wheel, or **Zoom −** / **Fit** / **+**.
- The stylesheet and scripts are loaded with the version number attached, so browsers fetch new copies after an update.

### Changed

- A new photo opens the crop screen before it's read, already turned by automatic straightening. **Cancel** drops the new photo. This applies to **Take or choose a photo**, **Add the rest of the receipt** and **Use a different photo**. The sample bill skips the crop screen.
- An untouched crop box reads the whole photo.

## [2.9.1] - 2026-11-15

### Changed

- Payments that add up to more than the bill before tips hold the split. The end line shows the difference and links to "Paid so far."
- **Add a gratuity** uses the same muted style as **Add a fee or surcharge** and **Add a discount**.
- Removed the note about payments from the step 2 hint.

## [2.9.0] - 2026-11-15

### Added

- **Fill in the rest** for the last payer once every other payer has entered an amount. It enters what's left of the bill before tips. Grayed out when the others already cover it.
- **Paid so far** under the payers' cards. Gray with the amount to go, green at the bill, red over it.

### Changed

- Tip boxes start empty with no percent selected. A blank tip doesn't hold the split, and the end line adds a gray "No tip added." A typed 0 adds no note.
- With several payers, each tip is **Percent** or **Amount**. **Total** remains for a single payer.
- "Paid so far" replaces "The cards cover the whole bill" and comes before the cards' tip line.

## [2.8.0] - 2026-11-15

### Added

- Total check at the top of step 4. It compares the receipt's printed items, tax, fees, gratuity, discounts and printed tip with the receipt's total. Green when they match, red with the difference when they don't. The tip entered in step 4 isn't counted.
- The split is held until the bill matches the receipt's total. The end line says whether the subtotal matches and links to the check.
- A link under a red total check adds the difference as a fee or a discount named **Receipt difference**, after a confirmation that defaults to **Cancel**.
- **Gratuity** list in step 4, between fees and discounts, with **Add a gratuity**. Printed gratuities and service charges go there under their printed name, split proportionally by default. Shares show "Gratuity" or "Fees and gratuity."

### Changed

- With a gratuity on the bill, the tip starts at 0% and a note says the gratuity is already included. Card tips with several payers also start at 0%, and the cards' tip line shows the amount on top of the gratuity.
- A tip printed on a card slip fills in the tip and counts toward the total check.
- End-of-page lines say "Select to jump to it" instead of "Tap."

## [2.7.1] - 2026-11-15

### Changed

- **Straighten** has an **Automatic** | **Manual** toggle. The slider and **−** / **+** switch to **Manual**, which reads exactly the angle shown, 0.0° included. **Automatic** goes back to the measured angle.
- The crop screen opens at the angle the photo was read with.
- Automatic straightening starts at 1° of lean instead of 3°.

## [2.7.0] - 2026-11-15

### Added

- Automatic straightening. The lean of the printed lines is measured between −20° and +20°, and photos leaning more than 3° are read from a straightened copy. If the copy reads worse, the photo as taken is used.
- The photo preview and **Show receipt** show the straightened photo, with gray corners.
- **Straighten** slider in the crop screen, −15° to +15° in half degrees, with **−** and **+** buttons and arrow keys.

### Changed

- **Try it with a sample bill** in the guide is a wide gold button.
- The guide covers straightening, and Troubleshooting has a line for crooked photos.

## [2.6.1] - 2026-11-14

### Fixed

- The sample bill's tea read as "Green Tea DER SE" in some browsers.
  - Photos are resized by the site (js/image.js) instead of the browser, by area averaging. Photos over 16 megapixels are first reduced by the browser.
  - A line with no price that is short, all capitals, and made only of one- to three-letter non-words is dropped instead of joined to the line above.
  - The sample photo is larger, with blank space between sections.

### Changed

- Add-ons no longer show "Goes with [dish]."
- The word list for i/l repairs grew from 518 to about 6,000 words, covering many more cuisines, drinks, bakery and bar terms, and diet tags. German words are listed with and without umlauts.
- Words that would turn common English, German, Spanish or French words into food words were left off, and a few food words were added to keep their twins unchanged. A capital L is never read as an i.

## [2.6.0] - 2026-11-14

### Added

- Guide page (guide.html), linked at the bottom of the site, with a section per step, Undo, privacy and troubleshooting.
- **Try it with a sample bill** at the top of the guide. It opens the site with a made-up "Sample Udon" receipt read by the real reader. **Start over** clears it, and `#sample` is removed from the address once it loads.
- **Split by quantity** in an item's **Options**. A row with quantity 3 becomes 3 rows of 1, the price divided evenly. Grayed out at quantity 1.
- **Move to discounts** on discount rows, in **Options** and next to **Uneven shares** when **Everyone** is selected.

### Changed

- Fee and tip sharing are named **Equal** and **Proportional** (they were "Split evenly" and "By order"), with **Equal** first.
- The Discounts list says "Shared proportionally."
- A discount row's note says "Discount." **Move to discounts** replaces **Spread over the whole bill**.
- Once the receipt difference is taken off as a discount, the check under the items becomes a muted note. It turns red again if the amounts change.
- A plain number at the start of a line is read as the quantity, unless the next word usually belongs to the name ("7 Layer Dip"), where **Split into 7?** is offered.
- Lines containing "discount" or "promo" are read as whole-bill discounts.

### Removed

- The **Split into − N + [Split]** control in Options.

## [2.5.1] - 2026-11-12

### Added

- **Take $X off as a discount** when the items add up to more than the receipt's subtotal. It adds a **Receipt difference** discount shared by what each person ordered.

### Changed

- The check under the items says which way it's off and by how much, then "Check the prices and totals against the photo."

## [2.5.0] - 2026-11-12

### Added

- **+ Add the rest of the receipt** adds another photo of the same receipt, with its items after the others. Photos show side by side, and **Show receipt** stacks them in order.
- Lines at the top of a new photo that repeat the bottom of the last one are skipped, and the note says how many. Undo restores them.
- With more than one photo, **Crop and re-read** and **Deep scan** ask which photo, and re-read only its items.
- Tall photos keep more detail for the reader.
- Whole-bill discounts are a list like fees, with names, amounts, ✕, **Options → Move to items**, **+ Add a discount** and a total.

### Changed

- Step 1 after a reading has **Crop and re-read** and **Deep scan** side by side, with **+ Add the rest of the receipt** and **Use a different photo** as links underneath. **Scan again** is now **Deep scan**.
- The note after a reading shows what was found, then the receipt's subtotal, tax and total ("—" when not found), then a heads-up line only when something needs attention.
- **Type or paste instead** is a full-size button under **Take or choose a photo**, hidden once a photo has given items.
- After a crop, the preview and **Show receipt** show the cropped, turned photo. **Crop and re-read** opens the whole photo.
- **Options** shows ▸ when closed and ▾ when open. Add-ons open and close with **Options**, and **Done** was removed.
- Undo restores photos too. **Start over** still releases every photo right away.

### Removed

- **Remove photo**.

## [2.4.0] - 2026-11-12

### Added

- **Undo** button above **Start over**, up to 20 steps, with a line saying what it undoes next and how many steps remain. The pop-up Undo uses the same steps.
- Reading a new receipt over an existing list, adding pasted lines, and **Start over** can be undone. Undoing **Start over** doesn't bring back the photo.
- **Move this item ↑ ↓** in Options. Add-ons move with their dish.
- Money boxes show a red edge and a message when the entry isn't a dollar amount, cleared once fixed. A lone "$", "." or "-" isn't flagged. The message is linked to the box for screen readers.
- "Everything's assigned." under **The split** once every item is claimed.

### Changed

- Item rows show the name and ✕, then the price, the per-item price when the quantity is more than one, and **Options**, with people underneath.
- **Change** is now **Options** everywhere, replacing **⋯** on tax and fee rows. It holds Quantity, Split into, Add an add-on, Attach to, Move this item, and **This item is: Item · Discount · Fee · Tax**, in a tinted panel.
- An add-on's Options has **Detach from [dish]** and **This item is: Add-on · Fee · Tax**. A tax or fee row's Options has **Move to items**.
- A dish with add-ons can become a fee, tax or discount. Its add-ons become their own rows, and the Undo message says so.
- Confirmations open in the site's own style. Esc or a tap outside cancels.
- Step 1 has one text option, **Type or paste instead**.
- The note after reading lists the item count, subtotal, tax and total, with "not found" for anything missing.
- Selected buttons are soft gold with a dark gold edge. **Everyone** has a solid outline.
- **Add a fee or surcharge** and **Add a discount** are gray links.
- A negative tax or fee is read as positive right away.

### Fixed

- An unreadable price no longer disappears when the list redraws.
- Accessibility. Tap areas of at least 44 × 44 px for Options and ✕, focus kept in place after item changes, and colors that meet WCAG AA contrast.

## [2.3.0] - 2026-11-09

### Added

- Tax and fees are listed line by line as printed, each with an amount and ✕, plus **+ Add tax** and **+ Add a fee**. Slips and copied text show one Tax line and one Fees line per person.
- Each fee can be split evenly or by order. Flat per-order charges start out even, and others start by order.
- The tip can be split evenly or by order. Delivery receipts start it even.
- **Make it a fee** and **Make it tax** in the **Change** menu, and **Make it an item** on tax and fee rows.
- The receipt's subtotal and total shown under the items, with **Edit**.
- **Show receipt** in step 3, kept in memory only.
- **Scan again** reads the same photo with darker grays.
- Faint quantities are taken from a darker second reading when rows and prices match exactly.
- Driver-benefit and Seattle worker-pay charges are recognized as fees.

### Changed

- Undo covers every **Change** action, tax and fee changes, subtotal and total edits, and Scan again.
- Undo stays up for 7 seconds instead of 5, waits while touched, focused or while the keyboard is up, and has a ✕.
- Tax and fee rows match the item row layout.

### Fixed

- Accessibility. Focus stays on the pressed button after a redraw and moves sensibly after a removal or Undo. The focus ring is navy with a khaki edge (WCAG 1.4.11). The **Change** button's spoken name no longer includes the arrow.

## [2.2.0] - 2026-11-07

### Added

- Quantities on each item as "− 2 + × $9.00." Changing the quantity keeps the line total.
- Quantities on the slips and in copied text ("2× Caesar Salad").
- **Change** menu under each item with **Quantity**, **Split into rows**, **Make it an add-on of …** and **Make it a discount** / **Make it a regular item**.
- Quantities printed under a dish ("2 @ $12.50") are read when they match the line total.
- Quantities in a column between the name and price are read.
- "Subtotal", "Total" and "Tax" are recognized with a misread letter or two.
- Subtotal, total and tax are inferred from lines that match the item sum, subtotal plus tax, or total minus subtotal.
- A fee with its amount on the line below is read as a fee.
- A darker second reading for faint print when the first doesn't match the subtotal.
- More state and city tax and fee names.
- Corkage, cake-cutting and split-plate charges come in as items.

### Changed

- Colors are navy (#002137) and khaki (#C0A86A).
- **Split into 2** moved under **Change** as **Split into rows**. **Split into 7?** still shows for names that may start with a quantity.
- **Make it an add-on of …** moved into the **Change** menu.
- With several readings, the one closest to the subtotal is kept.
- An indented line under a dish is never joined to its name.

### Fixed

- Discounts above the subtotal no longer cause a false "extra" warning.
- Fees above the subtotal are counted in the subtotal check.
- A misread "Subtotal" or "Total" line no longer becomes an item.
- Dish names containing words like "Wellness" are no longer read as fees.

## [2.1.0] - 2026-10-27

### Added

- More than one payer. Each payer enters what they paid and their tip as a percent, an amount or a card total. Tips are combined and split by what each person ordered.
- Payments that settle everyone up, shown in the results and on each slip.
- Flags for payments or cards that don't cover the bill, with the amount missing.
- Tip by total.
- Totals card at the top of the results, with **Copy totals**.
- **Crop and re-read**, with a crop box and a rotate button.
- **+ Add an add-on**, **Make it an add-on of …** and **Make it its own item**.
- Discounts field in the tax and tip section, split by what each person ordered, with **Spread over the whole bill**, **Make it a line item** and **Add a discount**.
- Undo for a few seconds after removing an item, add-on or person.
- A note at the bottom of the page that it isn't financial advice.
- Version number at the bottom of the page.

### Changed

- Add-ons follow their dish's people and no longer have their own person buttons.
- Discounts are recognized only by a negative amount. One right under a dish attaches to it.
- Tax and fees are split by what each person owes after discounts, and the tip by what they ordered before discounts. Percent tips use the food total before discounts.
- A printed tip is used only when the receipt's total includes it. Gratuity and service charges always count.
- A leading number stays in a dish name unless the receipt has a quantity column. **Split into N?** sits next to the price.
- Reading a new photo or re-reading a crop asks first if people are assigned.

### Fixed

- Dish names with "Happy Hour", "Off" or "Comp" were read as discounts.
- Dish names starting with a number lost the number.
- Dishes starting with a percent ("2% Milk") were dropped.
- Scanning a new receipt kept the previous tip.
- A message about an unnamed item started with a lowercase letter.
- Discounts below the subtotal threw off the subtotal check.

## [2.0.0] - 2026-10-26

### Added

- Add-ons such as "+ Avocado $1.50" are attached to their dish and follow its people.
- Dish names printed across two lines are joined when both lines are the same text size. Joined names are tagged, with **Split apart**.
- Joined-name tags turn amber when the items come up short of the subtotal.
- **Uneven shares** on items with two or more people, from 1 to 9 shares each.
- Quantity recognition for "2 Pizza", "2x Coke", "3 X Taco", "Fries x2" and "2 @ 7.50 15.00", plus **Split into 2**.
- Lines starting with a quantity but missing a price are kept with a blank price.
- When exactly one item is missing a price, the gap to the subtotal is filled in and marked amber. The split waits for **Looks right** or a typed price.
- **Add the missing $X** when the items come up short and no price is missing.
- Fees and surcharges are split like tax.
- Auto-gratuity is filled in as the tip, with a warning.
- Card slips are recognized, with a prompt to photograph the itemized check.
- Spelling repair for i/l mix-ups from a list of menu words.
- A misread leading "1" is removed from item names.
- Shadow and uneven-light correction, and a second reading when the items don't match the subtotal.
- Text size comparison uses tilt-corrected line heights.
- **Copy** under each share and **Copy everyone's shares**.
- Selecting a "Still unclaimed", "needs a price" or "Confirm the guessed price" message scrolls to the item.
- `noindex, nofollow` tag.

### Changed

- Item names use the full width, with the price on the line below.
- **Uneven shares** appears only with two or more people selected.
- Leading "1 " quantities are removed from item names.
- Slips show uneven shares as "3 of 5" and even ones as "÷2."

### Fixed

- Subtotals with a space instead of a decimal point ("$12 50") are recognized.
- Voided items, tip guide tables, VAT-included lines and footer promotions are no longer counted as items.
- Fees and surcharges are no longer listed as items to claim.

## [1.1.0] - 2026-10-03

### Added

- **Paste receipt text**, read by the same reader as photos. Pasted items are added to the list.
- Text pasted as two columns is paired back up line by line.
- Enter moves from an item's name to its price, then to a new row.

### Changed

- A blank last row no longer blocks the split.

## [1.0.0] - 2026-10-03

### Added

- Receipt photos are read in the browser by Tesseract.js. Photos are never uploaded.
- People list with a payer.
- Item assignment, with shared plates split evenly.
- Tax and tip split by each person's food and drink total. Tip by percent (15, 18, 20, 22 or custom) or amount.
- Subtotal check against the receipt.
- One receipt-style slip per person.
- Manual item entry.
- Money math in whole cents, with leftover pennies distributed.
- Nothing is saved. No database, server, cookies, local storage or IndexedDB, the reader's language-file cache is off, and the photo is released after reading.
- Nothing loads from other sites. Code is bundled, a strict Content Security Policy blocks outside scripts and requests, text is shown as plain text, and inputs have size limits.
