import assert from 'node:assert/strict';
import { parseMoney, parsePercent, splitEven, allocateProportional, computeSplit, formatMoney } from '../js/split.js';
import { parseReceiptText } from '../js/parse.js';

// money parsing
assert.equal(parseMoney('12.50'), 1250);
assert.equal(parseMoney('$12.5'), 1250);
assert.equal(parseMoney('12,50'), 1250);
assert.equal(parseMoney('1,234.56'), 123456);
assert.equal(parseMoney('(3.00)'), -300);
assert.equal(parseMoney('-3'), -300);
assert.equal(parseMoney('.99'), 99);
for (const bad of ['', 'abc', '1.234', '12..5', '1e5', 'Infinity', '9999999999', '<script>', '1,2,3']) assert.equal(parseMoney(bad), null, bad);
assert.equal(parsePercent('18'), 18); assert.equal(parsePercent('18.5%'), 18.5); assert.equal(parsePercent('101'), null); assert.equal(parsePercent('-5'), null);
assert.equal(formatMoney(123456), '$1,234.56'); assert.equal(formatMoney(-5), '−$0.05');

// even split
assert.deepEqual(splitEven(100, 3), [34, 33, 33]);
assert.deepEqual(splitEven(100, 3, 1), [33, 34, 33]);
assert.deepEqual(splitEven(-100, 3), [-34, -33, -33]);

// proportional sums exactly, randomized
for (let t = 0; t < 5000; t++) {
  const n = 1 + Math.floor(Math.random() * 8);
  const w = Array.from({ length: n }, () => Math.floor(Math.random() * 20000));
  const amt = Math.floor(Math.random() * 50000);
  const parts = allocateProportional(amt, w);
  assert.equal(parts.reduce((a, b) => a + b, 0), amt);
  parts.forEach((p, i) => { const exact = amt * Math.max(0,w[i]) / Math.max(1, w.reduce((a,b)=>a+b,0)); if (w.some(x=>x>0)) assert.ok(Math.abs(p - exact) < 1.0001); });
}

// full split
const people = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cy' }];
const items = [
  { id: 1, name: 'Steak', cents: 3000, assigned: new Set(['a']) },
  { id: 2, name: 'Salad', cents: 1000, assigned: new Set(['b']) },
  { id: 3, name: 'Fries', cents: 900, assigned: new Set(['a', 'b', 'c']) },
];
const r = computeSplit({ people, items, taxCents: 392, tipCents: 980 });
assert.equal(r.rows.reduce((s, x) => s + x.total, 0), r.grandTotal);
assert.equal(r.grandTotal, 4900 + 392 + 980);
assert.equal(r.rows[0].subtotal, 3300);
assert.ok(r.rows[0].tax > r.rows[1].tax && r.rows[1].tax > r.rows[2].tax);
assert.equal(r.unassigned.length, 0);

// fuzz full split totals
for (let t = 0; t < 2000; t++) {
  const ppl = Array.from({ length: 1 + Math.floor(Math.random() * 7) }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const its = Array.from({ length: 1 + Math.floor(Math.random() * 15) }, (_, i) => ({ id: i, name: 'i', cents: Math.floor(Math.random() * 5000) - (Math.random() < 0.1 ? 6000 : 0), assigned: new Set(ppl.filter(() => Math.random() < 0.5).map(p => p.id).concat([ppl[0].id])) }));
  const tax = Math.floor(Math.random() * 3000), tip = Math.floor(Math.random() * 5000);
  const res = computeSplit({ people: ppl, items: its, taxCents: tax, tipCents: tip });
  assert.equal(res.rows.reduce((s, x) => s + x.total, 0), res.grandTotal);
}

// receipt parsing
const txt = `THE BLUE DOOR
123 Main St
2 Margherita Pizza      28.00
Caesar Salad ........ 12.50
Iced Tea               3.75 T
Garlic Knots          $7.00
Coupon                -5.00
Subtotal              46.25
Sales Tax 8.875%       4.10
Total                 50.35
Suggested tip 20%     10.07
VISA ****1234         50.35
Change                 0.00`;
const parsed = parseReceiptText(txt);
assert.deepEqual(parsed.items.map(i => [i.name, i.cents]), [['2 Margherita Pizza', 2800], ['Caesar Salad', 1250], ['Iced Tea', 375], ['Garlic Knots', 700], ['Coupon', -500]]);
assert.equal(parsed.subtotalCents, 4625); assert.equal(parsed.taxCents, 410); assert.equal(parsed.totalCents, 5035); assert.equal(parsed.tipCents, null);
assert.deepEqual(parseReceiptText(null).items, []);
console.log('all unit tests passed');

// row rebuild from word boxes (two-column misread)
import { textFromWords, bestParse } from '../js/parse.js';
const wb = (text, x, y) => ({ text, bbox: { x0: x, y0: y, x1: x + 50, y1: y + 20 } });
const rebuilt = textFromWords([wb('Tea', 10, 100), wb('3.75', 300, 103), wb('Iced', -40, 99), wb('Fries', 10, 140), wb('9.00', 300, 138)]);
assert.equal(rebuilt, 'Iced Tea 3.75\nFries 9.00');
const best = bestParse('Iced Tea\nFries\n3.75\n9.00', rebuilt);
assert.equal(best.items.length, 2);
console.log('row rebuild tests passed');

import { pairColumns } from '../js/parse.js';
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
const paired = pairColumns(lens);
const pr = bestParse(lens, paired);
assert.deepEqual(pr.items.map(i => [i.name, i.cents]), [['2 Margherita Pizza', 2800], ['Caesar Salad', 1250], ['Iced Tea', 375]]);
assert.equal(pr.subtotalCents, 4425); assert.equal(pr.taxCents, 393);
// already-clean text is left alone
assert.equal(pairColumns('Iced Tea 3.75\nFries 9.00'), 'Iced Tea 3.75\nFries 9.00');
// more prices than names: untouched
assert.equal(bestParse('Tea\n3.75\n9.00', pairColumns('Tea\n3.75\n9.00')).items.length, 0);
console.log('paste pairing tests passed');
