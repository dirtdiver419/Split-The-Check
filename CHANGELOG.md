# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.10.0] - 2026-11-21

### Changed

- **A new photo opens the crop screen first,** before anything is read. Most photos catch some table, so this saves the read-crop-read-again loop, which was most of the waiting. It opens already turned by automatic straightening. Frame the receipt and select **Read this part**, or select it right away to read the whole photo as it is. **Cancel** drops the new photo without touching anything already read. This covers **Take or choose a photo**, **Add the rest of the receipt** and **Use a different photo**. The sample bill still reads straight away.
- A box nobody moved reads the whole photo, not the slightly smaller box drawn so its corners can be grabbed. So "as it is" really means as it is.

### Added

- **Zoom in the crop screen.** Pinch on a phone or scroll on a computer, up to 4×, centered on your fingers or the pointer. Two fingers drag the view around. Zoomed in, dragging inside the box moves the view too, since the box usually fills it. The corner handles stay the same size at every zoom, and handle moves get finer the closer you are. **Zoom −** / **Fit** / **+** buttons sit next to **↻ Rotate** for keyboards and trackpads. A quarter turn zooms back out.
- **Fresh files after every update.** The site's stylesheet and scripts are now loaded with the version number attached, so browsers fetch new copies when the version changes and keep using their saved copies otherwise. No more hard refreshing after an update to get rid of yesterday's styles.

## [2.9.1] - 2026-11-15

### Changed

- When the payers' amounts add up to more than the bill before tips, the split now waits, the same way it does for an unclaimed item. Paying too much before tips means something's off, like a typo or a tip entered as part of the payment. The end line says by how much, and selecting it jumps to "Paid so far."
- **Add a gratuity** is the same quiet gray as **Add a fee or surcharge** and **Add a discount**. It had been left out of the rule that styles the other two.
- Step 2's hint no longer mentions entering payments in step 4, since step 4 says so when it gets there.

## [2.9.0] - 2026-11-15

### Added

- **Fill in the rest.** With two or more payers, once everyone but one has entered what they paid, the last one gets a **Fill in the rest** link between their name and **Paid**. It types in what's left of the bill before tips, once, as an ordinary amount you can change. So "the rest on mine, please" takes one click. Grayed out when the others already cover it.
- **Paid so far**, under the payers' cards, keeps a running count against the bill before tips. It's gray while there's still some to go ("$10.03 to go"), green at exactly the bill, and red when the payments come out higher.

### Changed

- Tip boxes start empty, and no 15/18/20/22% button is selected. The site records a tip someone left, or is about to write on the slip, so it no longer suggests 20%. The buttons stay as shortcuts. A blank tip doesn't hold anything up. The shares show with no tip, and the end line adds a gray "No tip added" (or "No tip added for Ben"). A typed 0 counts as a choice and gets no note. This applies with a gratuity on the bill too, where the note above the tip still says it's already included.
- With several payers, each one's tip is **Percent** or **Amount**. The card **Total** option is gone there, since a slip prints the amount and tip separately anyway, and it kept "Paid so far" from adding up honestly. One payer still has **Total**.
- "Paid so far" comes before the cards' tip line, and replaces "The cards cover the whole bill."

## [2.8.0] - 2026-11-15

### Added

- **Total check** at the top of step 4. It adds up what the receipt itself printed (items, tax, fees, gratuity and discounts, plus a tip if the receipt printed one) and compares that with the receipt's total. Green when they match, red with the difference when they don't. A missing tax line now shows up right away, instead of quietly making everyone underpay. The tip you choose in step 4 isn't on the receipt, so it never counts.
- Until the bill matches the receipt's total, **The split** holds the shares back, the same way it does for an unclaimed item. The line says whether the subtotal matches, so you know where to look, and selecting it jumps to the check. A total the reader got wrong can be fixed with **Edit** in step 3.
- Under a red total line, a deliberately quiet link adds the difference as a fee (or takes it off as a discount). It asks first, with **Cancel** as the default, and the row it adds is called **Receipt difference**.
- **Gratuity** has its own list in step 4, between fees and discounts. A gratuity or service charge printed on the receipt lands there with its printed name ("Gratuity 18%"), split proportionally unless you pick **Equal**. **Add a gratuity** covers one the reader missed. Shares list it as "Gratuity", or "Fees and gratuity" when there are both.

### Changed

- With a gratuity on the bill, the tip starts at 0%, and a note above the tip says the gratuity is already included and any tip is extra. With two or more payers, card tips nobody has filled in start at 0% too, and the cards' tip line says what came on top of the gratuity. Restaurants that sneak in an 18% gratuity no longer get tipped twice.
- A tip printed on a card slip still fills in the tip, since someone already chose it, and counts toward the total check.
- The end-of-page lines say "Select to jump to it" instead of "Tap", since the site works with a mouse too.

## [2.7.1] - 2026-11-15

### Changed

- **Straighten** has an **Automatic** | **Manual** toggle. It always shows which one is in charge, highlighted gold like the site's other toggles. Moving the slider or tapping **−** or **+** switches to **Manual**, and Manual reads exactly the angle on screen, nothing more. That includes 0.0°, which used to mean "automatic" and couldn't be locked. Tapping **Automatic** turns the photo back to the measured angle.
- The crop screen now opens turned the way the photo was actually read. So if automatic straightening turned it 5°, the slider starts at 5.0° on Automatic, and the first tap of **+** gives 5.5° instead of jumping back to the crooked original.
- Automatic straightening starts at 1° of lean instead of 3°. Below 1° the measurement can't tell a lean from noise. The sample bill leans about 2.4°, so it's straightened now too.

## [2.7.0] - 2026-11-15

### Added

- **Automatic straightening.** A receipt photographed at a slant is now straightened before it's read. The site measures how far the printed lines lean by trying every angle from −20° to +20° and keeping the one where the rows of text line up most sharply (a projection profile, for the curious). Past 3°, the reader gets a straightened copy. If that copy somehow reads worse than the photo as taken, the site keeps whichever adds up. On made-up test receipts tilted 5° to 20°, 2.6.1 read almost nothing ("geef pho") and 2.7.0 reads every line.
- The photo at the top and **Show receipt** show the straightened photo, in color, with gray in the corners where it was turned. Photos leaning less than 3° stay as they were.
- **Straighten** in the crop screen: a slider from −15° to +15° in half degrees, with **−** and **+** buttons for exact steps. The photo turns as you move it, and the gold part of the track runs from the middle out to the knob. At 0 it says **Automatic**. Set any other angle and automatic straightening is off for that photo, so it reads at exactly your angle. Arrow keys move it half a degree at a time.

### Changed

- **Try it with a sample bill** in the guide is now a wide gold button instead of a link.
- The guide explains straightening, and Troubleshooting has a line for crooked photos.

## [2.6.1] - 2026-11-14

### Fixed

- The sample bill's tea came out as "Green Tea DER SE" in some browsers. The reader was seeing letters in the thin lines printed between sections and gluing them onto the dish above. Three fixes, any one of which would have done it:
  - The site now shrinks and enlarges photos itself (js/image.js) instead of leaving it to the browser. Safari's built-in shrinking is rougher than Chrome's and turns a thin printed line into speckles that look like letters. Now every browser hands the reader the same picture. Each output pixel is the average of every photo pixel it covers, so a line fades to gray instead of breaking up. Photos over 16 megapixels are first brought down part way by the browser, to keep phones from running out of memory.
  - A line with no price that is short, all capitals, and made only of one- to three-letter scraps that aren't real bill words ("DER SE") is dropped instead of being joined to the dish above. Real short bill words still join and still count, like SM, LG, XL, NO ICE, ADD EGG, TO GO, BBQ, PHO, BLT, IPA and OJ, plus every three-letter food word on the list.
  - The sample photo is bigger and sharper, with blank space instead of printed lines between sections.

### Changed

- Add-ons no longer say "Goes with [dish]" under their name. They sit right under their dish anyway.
- The word list that repairs the reader's i/l mix-ups went from 518 words to about 6,000. It now covers German (Hamburg, the north and NRW included), Spanish and Persian in depth, plus Puerto Rican, French, British and Irish, Ethiopian, Scandinavian, Austrian, Swiss, Greek, Turkish, Vietnamese, regional Chinese, Filipino, Lebanese and Middle Eastern, Moroccan, Caribbean, Cuban, Peruvian, Brazilian and Argentine, Cajun and Southern, Hawaiian, Polish, Ukrainian and Hungarian, Portuguese, Indonesian, Malaysian and Singaporean, Nepali, Tibetan and Pakistani, Dutch and Belgian, Balkan, Georgian, Russian and Central Asian, West African, more Latin American, Israeli and Afghan, Sri Lankan, Burmese, Lao and Cambodian. Also bar, brewery, café and bakery words, bubble tea, wine grapes, cocktails, steak cuts and barbecue, pizza toppings, sushi rolls, and diet tags like GF and vegan. So "Khachapur1" becomes Khachapuri and "Fr1kandel" becomes Frikandel. German words are on the list both as "broetchen" and "brotchen", since the reader turns an umlaut into either.
- Every word was checked against common English, German, Spanish and French words that differ only by an i or an l. A few words that would have turned real bill words into food words were left off (vla, which would turn "via" into "vla", for example). A few real food words were added so their twins stay put, like "tail" so a lobster tail doesn't become a lobster tall. A capital L is never treated as a possible i, so CHILL printed in capitals stays CHILL, while a lowercase "Chill" now becomes Chili.

## [2.6.0] - 2026-11-14

### Added

- **How to use it**: a guide page (guide.html), linked at the bottom of the site. One section per step of the site, each with a table of what every button does, plus Undo, privacy and troubleshooting. Plain HTML, no scripts.
- **Try it with a sample bill**, at the top of the guide. It opens the site with a made-up receipt from "Sample Udon" and reads it with the real reader, so every tool works on it, including **Crop and re-read** and **Deep scan**. A note says it's a sample, and **Start over** clears it. The `#sample` part of the address is removed once it loads, so a refresh starts empty.
- **Split by quantity** in an item's **Options**, right under **Quantity**: a row of 3 burgers becomes 3 rows of 1 burger each, the price divided evenly. It's grayed out while the quantity is 1.
- **Move to discounts** on discount rows, in **Options**, and as a link next to **Uneven shares** when **Everyone** is selected. It moves the discount to the Discounts list in step 4, shared proportionally.

### Changed

- "Equal" and "Proportional" are the names for how a fee or the tip is shared (they were "Split evenly" and "By order"), with **Equal** first in both places. Proportional means by how much each person ordered.
- The Discounts list says "Shared proportionally."
- A discount row's note just says "Discount". **Spread over the whole bill** is gone; **Move to discounts** replaces it.
- Once the receipt's difference is taken off as a discount, the check under the items turns from a red warning into a muted note with a khaki edge: "…The difference is taken off as a discount." If a price or the discount changes so they no longer match, it goes back to red.
- A plain number at the start of a line is now read as the quantity: "2 Salmon Nigiri 9.00" becomes 2 × $4.50. When the next word usually belongs to the dish's name, like "7 Layer Dip", "3 Cheese Pizza" or "6 Piece Nuggets", the number stays in the name and **Split into 7?** is offered as before.
- Lines with "discount" or "promo" in them are read as discounts on the whole bill, even when printed right under a dish.

### Removed

- The **Split into − N + [Split]** control in Options. **Split by quantity** does the same job with one tap.

## [2.5.1] - 2026-11-12

### Changed

- The check under the items says plainly which way it's off: "Items add up to $33.50, $10.00 less than the receipt's subtotal of $43.50" or "…$10.00 more than…", then "Check the prices and totals against the photo."

### Added

- When the items add up to more than the receipt's subtotal, **Take $10.00 off as a discount** adds a **Receipt difference** discount, shared by what each person ordered. For receipts that undercharged: everyone's shares then add up to what was actually charged, so whoever paid isn't paid back more than they spent.

## [2.5.0] - 2026-11-12

### Added

- Long receipts: **+ Add the rest of the receipt** in step 1 adds another photo of the same receipt, and its items go after the others instead of replacing them. Photos show side by side as Photo 1, Photo 2 and so on, and **Show receipt** stacks them in order.
- Lines at the top of a new photo that repeat the bottom of the last one (same name and price) are skipped, and the note says how many. Undo puts them back.
- When there's more than one photo, **Crop and re-read** and **Deep scan** ask which one ("Choose a photo"), and re-read only that photo's items, in place. Who had what on the other photos stays.
- Tall photos, like a long screenshot or a tight crop of a long receipt, keep more of their detail for the reader. A long, narrow made-up test receipt with small print went from nothing read to all 100 lines.
- Several discounts: whole-bill discounts are now a list like fees, each with a name, an amount, ✕ and **Options → Move to items**, plus **+ Add a discount** and a total. **Spread over the whole bill** adds the discount as its own named row.

### Changed

- Step 1 after a reading: **Crop and re-read** and **Deep scan** sit side by side as equal buttons, with **+ Add the rest of the receipt** and **Use a different photo** as quiet links underneath. **Scan again** is now **Deep scan**.
- The note after a reading is laid out instead of run together: what was found on one line, then the receipt's subtotal, tax and total as small labeled figures ("—" when not found), then a heads-up line with a khaki edge only when something needs attention (looks cut off, lines skipped, card slip, no prices).
- **Type or paste instead** is a full-size button under **Take or choose a photo**, and steps aside once a photo has given items to work with.
- After a crop, the step 1 preview and **Show receipt** show the cropped, turned photo. **Crop and re-read** still opens the whole photo so the crop can be changed.
- **Options** shows ▸ when closed and ▾ when open, the usual show-and-hide arrows. Add-ons open and close with **Options** like items do, so **Done** is gone.
- Undo now brings back photos too: undoing an added photo, a new photo or a re-crop puts the earlier photos back. **Start over** still lets go of every photo right away.

### Removed

- **Remove photo**. **Use a different photo** and **Start over** cover it.

## [2.4.0] - 2026-11-12

### Added

- **Undo** button above **Start over** that goes back up to 20 steps, one at a time. Under it: what the next tap undoes ("Undoes: Removed Iced Tea") and how many steps are left after that. The pop-up Undo uses the same list of steps.
- Reading a new receipt over an existing list, adding pasted lines, and **Start over** can now be undone too. (Start over lets go of the photo right away, so Undo brings back everything typed but not the photo.)
- **Move this item ↑ ↓** in Options, for putting rows back in receipt order. Add-ons move with their dish.
- Money boxes say right away when something can't be read as an amount: a red edge on the box and a short line under it ("The price doesn't look like a dollar amount."). It goes away as soon as the box is fixed. A lone "$", "." or "-" counts as still typing, not a mistake. The message is linked to the box for screen readers and read out once you leave the box. Covers every money box: prices, tax and fee amounts, the discount, the receipt subtotal and total, all tip boxes and each payer's boxes.
- "Everything's assigned." in green under **The split** once every item is claimed and nothing is wrong.

### Changed

- Item rows are simpler: name and ✕ on top, then the price (the only price you type), the per-item price as plain text when there's more than one ("3 × $3.34", rounded up to the cent), and **Options** at the right. People go underneath.
- **Change** is now **Options** everywhere, including add-ons and tax and fee rows (where it replaces **⋯**). The menu, top to bottom: Quantity, Split into, Add an add-on, Attach to [the item above], Move this item, and **This item is: Item · Discount · Fee · Tax**. It opens as a tinted panel with a khaki edge so it reads as part of the row it belongs to.
- An add-on's Options has **Detach from [dish]** and **This item is: Add-on · Fee · Tax**. A tax or fee row's Options has **Move to items**.
- Making a dish a fee, tax or discount no longer needs its add-ons removed first. They turn into rows of their own, and the Undo message says so ("Made Steak Frites tax · Crispy Shrimp is now its own item").
- Confirmations ("Replace the items?", "Start over?") open in the page's own style instead of the browser's plain pop-up. Esc or a tap outside the box cancels.
- Step 1 has one text option, **Type or paste instead**, for typing items line by line or pasting receipt text. Single items still go in with **Add an item** in step 3.
- The note after reading a receipt lists what was found: "Found 3 items. Subtotal $55.00 · Tax $4.68 · Total $59.68." Anything missing says "not found".
- Selected buttons (people, Everyone, Paid, tip type, tip percent, Split evenly / By order, This item is) are soft gold with a dark gold edge instead of navy, so they stand apart from action buttons. **Everyone** has a solid outline.
- **Add a fee or surcharge** and **Add a discount** are quieter gray links.
- A tax or fee typed as a negative ("-2.50") is read as $2.50 right away instead of being treated as a mistake until you leave the box.

### Fixed

- A price that couldn't be read no longer disappears when the list redraws. It stays in the box with its message until fixed.
- Accessibility: Options, ✕ and the add-on Options have tap areas of at least 44 × 44 px. Keyboard focus stays put after changing what an item is, splitting it, attaching it or moving it, and lands on the next row when a row turns into a fee or tax. New colors meet WCAG AA contrast.

## [2.3.0] - 2026-11-09

### Added

- Tax and fees are listed line by line, the way the receipt prints them ("Sales Tax", "Delivery Fee", "Service Fee"), each with its own amount and a ✕. **+ Add tax** and **+ Add a fee** add more. Slips and copied text still show one Tax line and one Fees line per person.
- Each fee can be **Split evenly** or split **By order**. Flat per-order charges (delivery, small order, expanded range, driver benefits) start out split evenly; everything else starts out by order.
- **Split the tip** evenly or by order. A delivery receipt starts it out even.
- **Make it a fee** and **Make it tax** in the **Change** menu, for a charge the reader took for a dish. Each tax or fee row has **Make it an item** under **⋯** to send it back.
- The receipt's subtotal and total are shown under the items with **Edit**, for when the reader got them wrong. The subtotal check uses the corrected number.
- **Show receipt** in step 3 shows the photo next to the items for checking. It stays in memory only, like before, and goes away with **Remove photo** or when the page closes.
- **Scan again** reads the same photo again with darker grays. Its Undo stays up until the next tap.
- Faint quantities: when a receipt adds up but has a lot of light-gray print, the photo is read once more with darker grays, and only quantities (like "2 @ $8.25") are taken from that reading, when the rows and prices match exactly.
- Driver-benefit and Seattle worker-pay charges are recognized as fees.

### Changed

- Undo now covers every **Change** action, tax and fee changes, subtotal and total edits, and Scan again, not just removals. The message says what happened ("Made Corkage Fee a fee").
- Undo stays up for 7 seconds instead of 5. It waits while it's touched or focused, while the on-screen keyboard is up, and for anyone moving around with a keyboard, and has a ✕ to close it.
- Tax and fee rows are laid out like item rows.

### Fixed

- Accessibility: keyboard focus stays on the button you pressed when the list redraws, and moves to the next row after a removal (or back to where you were after Undo). The focus ring is navy with a khaki edge so it shows on both the cream cards and the navy page (WCAG 1.4.11 non-text contrast). The **Change** button's spoken name no longer includes the arrow symbol.

## [2.2.0] - 2026-11-07

### Added

- Quantities are shown on each item as "− 2 + × $9.00" and can be changed. Changing the quantity keeps the line's total and recalculates the price per item.
- Quantities appear on the slips and in copied text, for example "2× Caesar Salad".
- **Change** menu under each item with **Quantity**, **Split into rows**, **Make it an add-on of …** and **Make it a discount** / **Make it a regular item**.
- Quantities printed on the line under a dish ("2 @ $12.50") are read when quantity × price equals the line total.
- Quantities printed in a column between the name and the price are read.
- "Subtotal", "Total" and "Tax" are recognized with a misread letter or two.
- A line equal to the sum of the items is treated as the subtotal, a line equal to subtotal plus tax as the total, and a line equal to total minus subtotal as the tax.
- A fee or surcharge whose amount is printed on the line below its name is read as a fee.
- Faint, light-gray print: when the first reading doesn't match the subtotal, the photo is read again with darker grays before the plain grayscale reading.
- Tax and fee names from more states and cities are recognized, such as meals, liquor and hospitality taxes, Hawaii's general excise tax (GET), bottle deposits and city surcharges.
- Corkage, cake-cutting and split-plate charges come in as items, so they can go to whoever they were for instead of being spread over everyone.

### Changed

- New colors: navy (#002137) and khaki (#C0A86A).
- **Split into 2** now lives under **Change** as **Split into rows**. Dish names that may start with a quantity ("7 Layer Dip") still show **Split into 7?** next to the price.
- **Make it an add-on of …** moved from the item card into the **Change** menu.
- When the photo is read more than once, the reading closest to the subtotal is kept, instead of the one that found the most prices.
- An indented line under a dish is never joined to the dish name.

### Fixed

- Discounts printed above the subtotal no longer cause a false "extra" warning.
- Fees printed above the subtotal are counted in the subtotal check, so it no longer reports them as missing.
- A misread "Subtotal" or "Total" line no longer becomes an item.
- Dish names with words like "Wellness" in them are no longer read as fees.

## [2.1.0] - 2026-10-27

### Added

- More than one payer: mark two or more people as payers and each one enters what they paid plus the tip they added (percent with the usual presets, a dollar amount, or just their card total). Tips are added together and spread by what each person ordered.
- Who pays whom: the results list the payments that settle everyone up, and each slip says who to pay ("Pays Ana $12.40 and Ben $9.15") or what's coming back.
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

- Add-ons such as "+ Avocado $1.50" are attached to their dish and go to the same people automatically. Tap **Change** to assign an add-on separately.
- Dish names printed across two lines ("Spicy Chicken" / "Sandwich") are joined when both lines are clearly the same text size. Joined names are tagged, and **Split apart** undoes the join.
- Joined-name tags turn amber when the items come up short of the subtotal, since that is when a join could have hidden an item.
- Uneven shares: tap **Uneven shares** on any item with two or more people, then use + and − to set shares from 1 to 9. Each person pays their shares divided by the total.
- Quantity recognition for "2 Pizza", "2x Coke", "3 X Taco", "Fries x2" and unit-price lines such as "2 @ 7.50 15.00". **Split into 2** turns one line into separate rows.
- Lines that start with a quantity but lost their price are kept as rows with a blank price instead of being dropped.
- When exactly one item is missing its price, the gap to the subtotal is filled in and marked amber. The split will not calculate until the price is confirmed with **Looks right** or typed in.
- **Add the missing $X** button when the items come up short of the subtotal and no row is missing a price.
- Fees and surcharges (kitchen appreciation, health mandates, card surcharges) are split like tax, by what each person ordered. A fees field appears automatically, or can be added by hand.
- Auto-gratuity on the receipt is filled in as the tip, with a warning not to tip twice.
- Card slips are recognized, with a prompt to photograph the itemized check instead.
- Spelling repair for the reader's i/l mix-ups ("Splcy" → "Spicy", "Tlramlsu" → "Tiramisu") using a built-in list of common menu words.
- A misread leading "1" (read as "l", "I" or "il") is removed from item names.
- Shadow and uneven-light correction before reading. If the items don't match the subtotal, the photo is read a second time and the better result is kept.
- Tilted photos are handled better: text size is compared using the reader's tilt-corrected line heights, measured across the whole page.
- **Copy** button under each person's share, and **Copy everyone's shares**, producing plain text ready to paste into a message.
- Tapping a "Still unclaimed", "needs a price" or "Confirm the guessed price" message scrolls to and highlights that item.
- Search engines are asked not to list the site (`noindex, nofollow` tag).

### Changed

- Item names now use the full width of the screen, with the price on its own line below, so long names are no longer cut off.
- The **Uneven shares** link only appears once two or more people are selected on an item.
- Leading "1 " quantities are removed from item names.
- Slips show shares as "3 of 5" for uneven splits and "÷2" for even ones.

### Fixed

- Subtotals read with a space instead of a decimal point ("$12 50") are now recognized.
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

- Receipt photos are read on your own phone by an open-source text reader (Tesseract.js). Photos are never uploaded.
- People list with a payer, so each share shows who to pay back.
- Tap-to-assign items, with shared plates split evenly between the people selected.
- Tax and tip split in proportion to each person's food and drink total. Tip by percent (15, 18, 20, 22 or custom) or by amount.
- Subtotal check that compares the items against the receipt's subtotal.
- Results shown as one receipt-style slip per person.
- Manual item entry for receipts the reader can't handle.
- Exact money math in whole cents, with leftover pennies distributed so every share adds up to the total.
- Privacy: nothing is saved. There's no database, server or cookies, the browser's local storage and IndexedDB aren't used, the reader's language-file cache is turned off, and the photo is released as soon as it has been read.
- Security: nothing loads from other sites. All code is bundled with the page, a strict Content Security Policy blocks outside scripts and requests, names and receipt text are always shown as plain text, and inputs have size limits.
