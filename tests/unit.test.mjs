// Run with: node tests/unit.test.mjs
import assert from 'node:assert/strict';
import {
  parseMoney, parsePercent, splitEven, allocateProportional, allocateShares, computeSplit, formatMoney,
} from '../js/split.js';
import {
  parseReceiptText, parseLines, textFromWords, bestParse, pairColumns, fixWord, fixSpelling,
} from '../js/parse.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error(`FAIL: ${name}`); throw e; }
}
const items = (r) => r.items.map((i) => [i.name, i.cents]);

/* ------------------------------------------------------------------ money */

test('money parsing', () => {
  assert.equal(parseMoney('12.50'), 1250);
  assert.equal(parseMoney('$12.5'), 1250);
  assert.equal(parseMoney('12,50'), 1250);
  assert.equal(parseMoney('1,234.56'), 123456);
  assert.equal(parseMoney('(3.00)'), -300);
  assert.equal(parseMoney('-3'), -300);
  assert.equal(parseMoney('.99'), 99);
  for (const bad of ['', 'abc', '1.234', '12..5', '1e5', 'Infinity', '9999999999', '<script>', '1,2,3']) assert.equal(parseMoney(bad), null, bad);
  assert.equal(parsePercent('18'), 18); assert.equal(parsePercent('18.5%'), 18.5);
  assert.equal(parsePercent('101'), null); assert.equal(parsePercent('-5'), null);
  assert.equal(formatMoney(123456), '$1,234.56'); assert.equal(formatMoney(-5), '−$0.05');
});

test('even and proportional splits add up exactly', () => {
  assert.deepEqual(splitEven(100, 3), [34, 33, 33]);
  assert.deepEqual(splitEven(-100, 3), [-34, -33, -33]);
  for (let t = 0; t < 5000; t++) {
    const n = 1 + Math.floor(Math.random() * 8);
    const w = Array.from({ length: n }, () => Math.floor(Math.random() * 20000));
    const amt = Math.floor(Math.random() * 50000);
    assert.equal(allocateProportional(amt, w).reduce((a, b) => a + b, 0), amt);
    const off = Math.floor(Math.random() * 10);
    assert.equal(allocateShares(amt, w, off).reduce((a, b) => a + b, 0), amt);
  }
  assert.deepEqual(allocateShares(1895, [3, 2]), [1137, 758]);
  // tie pennies rotate with the offset
  assert.deepEqual(allocateShares(100, [1, 1, 1], 0), [34, 33, 33]);
  assert.deepEqual(allocateShares(100, [1, 1, 1], 1), [33, 34, 33]);
});

test('split with shares, add-ons and fees', () => {
  const people = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cy' }, { id: 'd', name: 'Dee' }];
  const m = (o) => new Map(Object.entries(o));
  const its = [
    { name: 'Chicken Udon', cents: 1495, assigned: m({ a: 1 }) },
    { name: 'Boiled Egg', cents: 200, addon: true, assigned: m({ a: 1 }) },
    { name: 'Bento Box', cents: 1895, assigned: m({ b: 1 }) },
    { name: 'Black Garlic Ramen', cents: 1645, assigned: m({ c: 1 }) },
    { name: 'Tobiko Nigiri', cents: 375, assigned: m({ d: 1 }) },
    { name: 'Chicken Katsu Udon', cents: 1595, assigned: m({ d: 1 }) },
    { name: 'Boiled Egg', cents: 200, addon: true, assigned: m({ d: 1 }) },
    { name: 'Chu-toro Nigiri', cents: 625, assigned: m({ c: 1 }) },
    { name: 'Double Hamachi Roll', cents: 1895, assigned: m({ a: 3, b: 2 }) },
  ];
  const r = computeSplit({ people, items: its, taxCents: 868, tipCents: 1985 });
  assert.deepEqual(r.rows.map((x) => x.total), [3646, 3416, 2922, 2794]);
  assert.equal(r.grandTotal, 12778);
  const ham = r.rows[0].lines.find((l) => l.name === 'Double Hamachi Roll');
  assert.equal(ham.shares, 3); assert.equal(ham.totalShares, 5); assert.equal(ham.even, false);

  const f = computeSplit({ people: people.slice(0, 2), items: [{ name: 'X', cents: 1000, assigned: m({ a: 1, b: 1 }) }], taxCents: 0, tipCents: 0, feeCents: 301 });
  assert.equal(f.rows[0].fee + f.rows[1].fee, 301);
  assert.equal(f.grandTotal, 1301);
});

test('fuzz: every split sums to the grand total', () => {
  for (let t = 0; t < 2000; t++) {
    const ppl = Array.from({ length: 1 + Math.floor(Math.random() * 7) }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const its = Array.from({ length: 1 + Math.floor(Math.random() * 15) }, (_, i) => {
      const assigned = new Map([[ppl[0].id, 1 + Math.floor(Math.random() * 9)]]);
      ppl.forEach((p) => { if (Math.random() < 0.5) assigned.set(p.id, 1 + Math.floor(Math.random() * 9)); });
      return { name: 'i' + i, cents: Math.floor(Math.random() * 5000) - (Math.random() < 0.1 ? 6000 : 0), assigned };
    });
    const res = computeSplit({ people: ppl, items: its, taxCents: Math.floor(Math.random() * 3000), tipCents: Math.floor(Math.random() * 5000), feeCents: Math.floor(Math.random() * 900) });
    assert.equal(res.rows.reduce((s, x) => s + x.total, 0), res.grandTotal);
  }
});

/* --------------------------------------------------------------- spelling */

test('i/l spelling repairs', () => {
  assert.equal(fixWord('Bolled'), 'Boiled');
  assert.equal(fixWord('Terlyaki'), 'Teriyaki');
  assert.equal(fixWord('Callfornla'), 'California');
  assert.equal(fixWord('Chlcken'), 'Chicken');
  assert.equal(fixWord('GRlLLED'), 'GRILLED');
  assert.equal(fixWord('Subtota1:'), 'Subtotal:');
  assert.equal(fixWord('Nigiri'), 'Nigiri'); // already right
  assert.equal(fixWord('Bill'), 'Bill'); // not a menu word, left alone
  assert.equal(fixWord('Hashiya'), 'Hashiya');
  assert.equal(fixWord('$14.95'), '$14.95');
  assert.equal(fixSpelling('-Bolled Egg'), '-Boiled Egg');
});

/* --------------------------------------------------------------- receipts */

// 1. The real Hashiya receipt, with the reader's size data for each line.
const HASHIYA = [
  ['DINE IN', 37, 27], ['Hashiya Sushi &', 70, 47], ['Ramen', 59, 47], ['37 Railroad Avenue', 38, 28], ['Danville, CA 94526', 40, 28],
  ['925-272-2366', null, 26], ['10/24/26 12:18:46 GGT. 4 BT', 66, 34], ['PM 4', 35, 26], ['7) DINE IN A2', 43, 30],
  ['1 Chicken Udon $14.95', 43, 29], ['-Bolled Egg $2.00', 34, 27],
  ['1 Bento Box $18.95', 41, 31], ['Chicken Terlyaki', 34, 25], ['8Pcs Callfornia Roll', 34, 26],
  ['1 Black Garlic $16.45', 42, 30], ['Ramen', 40, 31], ['Grilled Chicken(Dark', 34, 26], ['Meat)', null, 27],
  ['1 Tobiko Nigiri $3.75', 42, 30], ['(1pc)', null, 38],
  ['1 Chicken Katsu $15.95', 43, 31], ['Udon', 42, 31], ['-Bolled Egg $2.00', 35, 26],
  ['1 Chu-toro Nigiri $6.25', 41, 30], ['(1pc)', null, 40],
  ['1 Double Hamachi $18.95', 42, 30], ['Roll', 43, 30],
  ['Subtotal: $99 25', 61, 28], ['Tax: $8.68', 37, 26], ['Total: $107.93', 48, 33],
].map(([text, cap, xh]) => ({ text, cap, xh }));

test('Hashiya receipt', () => {
  const r = parseLines(HASHIYA);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents, i.addon, i.parent]), [
    ['Chicken Udon', 1495, false, null],
    ['Boiled Egg', 200, true, 0],
    ['Bento Box', 1895, false, null],
    ['Black Garlic Ramen', 1645, false, null],
    ['Tobiko Nigiri', 375, false, null],
    ['Chicken Katsu Udon', 1595, false, null],
    ['Boiled Egg', 200, true, 5],
    ['Chu-toro Nigiri', 625, false, null],
    ['Double Hamachi Roll', 1895, false, null],
  ]);
  assert.deepEqual(r.items[3].joined, { base: 'Black Garlic', extra: 'Ramen' });
  assert.equal(r.subtotalCents, 9925); assert.equal(r.taxCents, 868); assert.equal(r.totalCents, 10793);
  assert.equal(r.items.reduce((s, i) => s + i.cents, 0), r.subtotalCents);
});

test('Hashiya receipt with the tobiko price lost', () => {
  const lines = HASHIYA.map((l) => (l.text.startsWith('1 Tobiko') ? { ...l, text: '1 Tobiko Nigiri' } : l));
  const r = parseLines(lines);
  const t = r.items.find((i) => i.name === 'Tobiko Nigiri');
  assert.ok(t, 'quantity line kept as an item');
  assert.equal(t.cents, null);
  assert.equal(r.items.length, 9);
});

test('Hashiya receipt as plain text never joins lines', () => {
  const r = parseReceiptText(HASHIYA.map((l) => l.text).join('\n'));
  assert.ok(r.items.every((i) => !i.joined));
  assert.ok(items(r).some(([n]) => n === 'Chicken Katsu'));
});

// 2. A plain US diner check.
test('classic diner check', () => {
  const r = parseReceiptText(`MEL'S DINER
Server: Joe   Table 12
Guests: 3
Cheeseburger            12.95
Caesar Salad            10.50
Iced Tea                 3.25 T
Subtotal                26.70
Tax                      2.34
Total                   29.04
Suggested tip 18%: 4.81
Suggested tip 20%: 5.34
VISA ****4421           29.04
Change                   0.00`);
  assert.deepEqual(items(r), [['Cheeseburger', 1295], ['Caesar Salad', 1050], ['Iced Tea', 325]]);
  assert.equal(r.subtotalCents, 2670); assert.equal(r.taxCents, 234); assert.equal(r.totalCents, 2904);
  assert.equal(r.tipCents, null);
});

// 3. Every way restaurants print a quantity.
test('quantity styles', () => {
  const r = parseReceiptText(`2 Margherita Pizza   28.00
2x Coke               6.00
3 X Taco             12.00
Fries x2              9.00
1 Garlic Knots        7.00`);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents, i.qty]), [
    ['Margherita Pizza', 2800, 2], ['Coke', 600, 2], ['Taco', 1200, 3], ['Fries', 900, 2], ['Garlic Knots', 700, 1],
  ]);
});

// 4. Unit price plus line total: the line total wins.
test('unit price lines', () => {
  const r = parseReceiptText(`Iced Tea 2 @ 3.50      7.00
2 Draft Beer @ 6.00    12.00
Wings 3 x $4.00        12.00`);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents, i.qty]), [['Iced Tea', 700, 2], ['Draft Beer', 1200, 2], ['Wings', 1200, 3]]);
});

// 5 + 6. Priced add-ons attach to their dish; free modifiers vanish.
test('add-ons and modifiers', () => {
  const r = parseReceiptText(`Club Sandwich          13.00
  + Avocado             1.50
  Add Bacon             2.00
  NO onions
  Extra spicy           0.00
Burger                 14.00
  w/ Sweet Potato Fries 3.00
  2 Boiled Egg          4.00
Soup                    6.00`);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents, i.addon, i.parent]), [
    ['Club Sandwich', 1300, false, null],
    ['Avocado', 150, true, 0],
    ['Add Bacon', 200, true, 0],
    ['Burger', 1400, false, null],
    ['w/ Sweet Potato Fries', 300, true, 3],
    ['Boiled Egg', 400, false, null], // no add-on signal in plain text: still the right money
    ['Soup', 600, false, null],
  ]);
});

test('add-on with a quantity and a symbol', () => {
  const r = parseReceiptText(`Ramen 15.00
2 -Boiled Egg 4.00`);
  assert.deepEqual(r.items.map((i) => [i.name, i.cents, i.addon, i.qty]), [['Ramen', 1500, false, 1], ['Boiled Egg', 400, true, 2]]);
});

// 7. Discounts, before and after the subtotal.
test('discounts', () => {
  const r = parseReceiptText(`Margarita              12.00
Happy Hour             -2.00
Nachos                 11.00
Coupon                 (5.00)
Pie                     6.00
Comp Dessert            6.00-
Subtotal               16.00
Loyalty Reward         -1.00
Tax                     1.40
Total                  16.40`);
  assert.deepEqual(items(r), [['Margarita', 1200], ['Happy Hour', -200], ['Nachos', 1100], ['Coupon', -500], ['Pie', 600], ['Comp Dessert', -600], ['Loyalty Reward', -100]]);
});

// 8. Voided lines.
test('voided items are ignored', () => {
  const r = parseReceiptText(`Margarita              12.00
VOID Margarita         12.00
Margarita VOIDED       12.00
Tacos                  14.00`);
  assert.deepEqual(items(r), [['Margarita', 1200], ['Tacos', 1400]]);
});

// 9. California-style fees are split like tax, not claimed as items.
test('fees and surcharges', () => {
  const r = parseReceiptText(`Burrito Bowl           14.00
Horchata                4.00
Subtotal               18.00
Kitchen Appreciation 4% 0.72
SF Health Mandate       0.90
Card Surcharge 3%       0.59
Tax                     1.55
Total                  21.76`);
  assert.deepEqual(items(r), [['Burrito Bowl', 1400], ['Horchata', 400]]);
  assert.equal(r.feeCents, 72 + 90 + 59);
  assert.equal(r.taxCents, 155);
});

// 10. Auto-gratuity for big parties.
test('auto-gratuity becomes the tip and is flagged', () => {
  const r = parseReceiptText(`Family Platter         96.00
Subtotal               96.00
Gratuity 18% (6+)      17.28
Tax                     8.40
Total                 121.68`);
  assert.equal(r.tipCents, 1728); assert.equal(r.gratuity, true);
  assert.deepEqual(items(r), [['Family Platter', 9600]]);
});

// 11. Several tax lines add up.
test('multiple tax lines', () => {
  const r = parseReceiptText(`Steak 40.00
State Tax 2.40
City Tax 0.80
Liquor Tax 0.30
Total 43.50`);
  assert.equal(r.taxCents, 350);
});

// 12. Tip guide tables, in both common layouts.
test('tip guide tables are ignored', () => {
  const a = parseReceiptText(`Pasta 20.00
Total 21.80
Tip Guide
18%    3.92
20%    4.36
22%    4.80`);
  assert.equal(a.tipCents, null); assert.deepEqual(items(a), [['Pasta', 2000]]);
  const b = parseReceiptText(`Pasta 20.00
Total 21.80
Tip 15%: 3.27
Tip 20%: 4.36`);
  assert.equal(b.tipCents, null);
  const c = parseReceiptText(`Pasta 20.00
Tip (20%) 4.00
Total 25.80`);
  assert.equal(c.tipCents, 400); // one tip line that was actually added
});

// 13. European receipt with VAT already included and decimal commas.
test('VAT-included receipts', () => {
  const r = parseReceiptText(`Schnitzel            18,50
Apfelschorle          3,80
Summe                22,30
inkl. MwSt 19%        3,56
incl. VAT 19%         3,56`);
  assert.deepEqual(items(r).slice(0, 2), [['Schnitzel', 1850], ['Apfelschorle', 380]]);
  assert.equal(r.taxCents, null);
});

// 14. A card slip instead of the itemized check.
test('card slip is recognized', () => {
  const r = parseReceiptText(`HASHIYA SUSHI
VISA ****1234
Auth code 004512
Amount: $107.93
Tip: ________
Total: ________
Signature`);
  assert.equal(r.cardSlip, true); assert.equal(r.items.length, 0);
});

// 15 + 16. Missing prices with a quantity, and street numbers in the header.
test('missing price kept; header numbers ignored', () => {
  const r = parseReceiptText(`37 Railroad Avenue
2 Main St
1 Ramen 15.00
1 Gyoza
1 Beer 7.00
Subtotal 28.00`);
  assert.deepEqual(items(r), [['Ramen', 1500], ['Gyoza', null], ['Beer', 700]]);
});

// 17. Spelling repairs flow through to names.
test('spelling repairs in item names', () => {
  const r = parseReceiptText(`Chlcken Terlyaki 15.00
Callfornla Roll 8.00
Grllled Salmon 22.00`);
  assert.deepEqual(items(r), [['Chicken Teriyaki', 1500], ['California Roll', 800], ['Grilled Salmon', 2200]]);
});

// 18. Two-column text from Google Lens.
test('Lens two-column paste', () => {
  const lens = `THE BLUE DOOR
123 Main Street
2 Margherita Pizza
Caesar Salad
Iced Tea
28.00
12.50
3.75
Subtotal
Sales Tax
44.25
3.93
Thank you!`;
  const r = bestParse(lens, pairColumns(lens));
  assert.deepEqual(items(r), [['Margherita Pizza', 2800], ['Caesar Salad', 1250], ['Iced Tea', 375]]);
  assert.equal(r.subtotalCents, 4425); assert.equal(r.taxCents, 393);
  assert.equal(pairColumns('Iced Tea 3.75\nFries 9.00'), 'Iced Tea 3.75\nFries 9.00');
});

// 19. Footer junk after the totals stays out of the items.
test('footer lines after totals are ignored', () => {
  const r = parseReceiptText(`Pho 14.00
Subtotal 14.00
Tax 1.22
Total 15.22
Join our rewards 5.00 off
Gift cards available 25.00`);
  assert.deepEqual(items(r), [['Pho', 1400]]);
});

/* ------------------------------------------------- size-based line joining */

const L = (text, cap, xh) => ({ text, cap, xh });

test('joins only one same-size line right after a dish', () => {
  const r = parseLines([
    L('1 Chicken Katsu 15.95', 42, 30), L('Udon', 42, 30), L('Extra Line', 42, 30),
    L('1 Pad Thai 14.00', 42, 30),
  ]);
  assert.deepEqual(items(r), [['Chicken Katsu Udon', 1595], ['Pad Thai', 1400]]);
});

test('tilted photo: word boxes ignored, tilt-proof size still joins', () => {
  const T = (text, cap, xh) => ({ text, cap, xh, slope: text.length >= 12 ? -0.05 : 0.01 });
  const r = parseLines([T('1 Black Garlic 16.45', 47, 30), T('Ramen', 39, 31), T('Grilled Chicken(Dark', 50, 26), T('1 Bento Box 18.95', 43, 30), T('Chicken Teriyaki', 36, 26)]);
  assert.deepEqual(items(r), [['Black Garlic Ramen', 1645], ['Bento Box', 1895]]);
});

test('tilted photo: smaller description is still not joined', () => {
  const r = parseLines([{ text: '1 Bento Box 18.95', cap: 43, xh: 30, slope: 0.05 }, { text: 'California Roll', cap: 49, xh: 26, slope: 0.05 }]);
  assert.equal(r.items[0].joined, null);
});

test('noisy angle on a short line does not count as page tilt', () => {
  const r = parseLines([{ text: '1 Tobiko Nigiri $3.75', cap: 42, xh: 30, slope: 0 }, { text: '(1pc)', cap: null, xh: 30, slope: 0.08 }, { text: '1 Chicken Udon 14.95', cap: 42, xh: 30, slope: 0 }]);
  assert.equal(r.items[0].name, 'Tobiko Nigiri');
});

test('a misread leading 1 is stripped', () => {
  const r = parseReceiptText('il Chicken Katsu Udon 15.95\nl Bento Box 18.95\nI Pho 14.00');
  assert.deepEqual(items(r), [['Chicken Katsu Udon', 1595], ['Bento Box', 1895], ['Pho', 1400]]);
});

test('ambiguous size does not join', () => {
  const r = parseLines([L('1 Chicken Katsu 15.95', 42, 30), L('Udon', 37, 27)]);
  assert.deepEqual(items(r), [['Chicken Katsu', 1595]]);
});

test('one size measure disagreeing blocks the join', () => {
  const r = parseLines([L('1 Chicken Katsu 15.95', 42, 30), L('Udon', 42, 25)]);
  assert.equal(r.items[0].joined, null);
});

test('clearly smaller priced line is an add-on even without a symbol', () => {
  const r = parseLines([L('1 Ramen 15.00', 42, 30), L('Boiled Egg 2.00', 32, 24), L('1 Gyoza 7.00', 42, 30)]);
  assert.deepEqual(r.items.map((i) => [i.name, i.addon, i.parent]), [['Ramen', false, null], ['Boiled Egg', true, 0], ['Gyoza', false, null]]);
});

test('slightly smaller priced line stays a normal item', () => {
  const r = parseLines([L('1 Ramen 15.00', 42, 30), L('Boiled Egg 2.00', 37, 27)]);
  assert.equal(r.items[1].addon, false);
});

test('small quantity line without a price is a description, not a missing item', () => {
  const r = parseLines([L('1 Bento Box 18.95', 41, 31), L('8 Pcs California Roll', 34, 26), L('1 Pho 14.00', 41, 31)]);
  assert.deepEqual(items(r), [['Bento Box', 1895], ['Pho', 1400]]);
});

/* ------------------------------------------------------------ word rebuild */

test('rows rebuilt from word boxes', () => {
  const wb = (text, x, y) => ({ text, bbox: { x0: x, y0: y, x1: x + 50, y1: y + 20 } });
  const rebuilt = textFromWords([wb('Tea', 10, 100), wb('3.75', 300, 103), wb('Iced', -40, 99), wb('Fries', 10, 140), wb('9.00', 300, 138)]);
  assert.equal(rebuilt, 'Iced Tea 3.75\nFries 9.00');
});

test('garbage input is harmless', () => {
  assert.deepEqual(parseReceiptText(null).items, []);
  assert.deepEqual(parseLines('nope').items, []);
  const r = parseReceiptText('<img src=x onerror=alert(1)> 5.00');
  assert.equal(r.items[0].cents, 500); // kept as text; the page never renders it as HTML
});

console.log(`${passed} tests passed`);
