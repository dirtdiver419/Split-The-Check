// All money is handled as integer cents. No floats touch a dollar amount.

const MAX_CENTS = 100_000_000; // $1,000,000 ceiling. Nobody's dinner costs more.

/**
 * Parse user- or OCR-supplied money text into integer cents.
 * Accepts "12.50", "$12.50", "12,50", "1,234.56", "-3.00", "(3.00)".
 * Returns null for anything that isn't clearly an amount.
 */
export function parseMoney(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[\s$€£]/g, '');
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }

  if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.'); // decimal comma
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) {
    s = s.replace(/,/g, ''); // thousands separators
  }

  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;

  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/** Parse a percentage like "18", "18.5", "18%". Returns a number in [0, 100] or null. */
export function parsePercent(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/%$/, '').trim();
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}

export function formatMoney(cents) {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

/** Plain "12.50" form for editable inputs. */
export function centsToInput(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Split `amount` cents into `n` parts that differ by at most one cent and sum
 * exactly to `amount`. `offset` rotates who absorbs the leftover pennies so the
 * same person doesn't eat every extra cent across a long receipt.
 */
export function splitEven(amount, n, offset = 0) {
  if (n <= 0) return [];
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const base = Math.floor(abs / n);
  const extra = abs - base * n;
  const parts = new Array(n).fill(base);
  for (let k = 0; k < extra; k++) parts[(offset + k) % n] += 1;
  return parts.map((p) => p * sign);
}

/**
 * Allocate `amount` cents across `weights` in proportion, using the
 * largest-remainder method so the parts sum exactly to `amount`.
 * Negative weights count as zero. If every weight is zero, split evenly.
 */
export function allocateProportional(amount, weights) {
  const n = weights.length;
  if (n === 0) return [];
  const w = weights.map((x) => BigInt(Math.max(0, x)));
  const total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) return splitEven(amount, n);

  const sign = amount < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(amount));
  const base = w.map((x) => (abs * x) / total);
  const rem = w.map((x, i) => ({ i, r: (abs * x) % total }));
  let left = Number(abs - base.reduce((a, b) => a + b, 0n));

  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const parts = base.map(Number);
  for (let k = 0; k < left; k++) parts[rem[k].i] += 1;
  return parts.map((p) => p * sign);
}

/** Proportional split where leftover pennies rotate with `offset`, so ties don't always favor the same person. */
export function allocateShares(amount, weights, offset = 0) {
  const n = weights.length;
  if (n === 0) return [];
  const k = ((offset % n) + n) % n;
  const rotated = weights.slice(k).concat(weights.slice(0, k));
  const parts = allocateProportional(amount, rotated);
  return parts.slice(n - k).concat(parts.slice(0, n - k));
}

/**
 * Work out what everyone owes.
 *
 * people: [{ id, name }]
 * items:  [{ name, cents, addon?, assigned: Map<personId, shares> }]
 *         (negative cents = a discount on one item, assigned like any item)
 * taxCents, tipCents, feeCents: integers (cents)
 * discountCents: whole-bill discount as a positive number (a $10 coupon is 1000)
 *
 * Each item is divided by shares (Ana 3, Ben 2 -> 3/5 and 2/5).
 * - Whole-bill discounts are spread by what each person ordered (before discounts).
 * - Tax and fees are spread by what each person owes for food after discounts,
 *   because restaurants charge tax on the discounted price.
 * - Tip is spread by what each person ordered before discounts, since the
 *   service was the same either way.
 */
export function computeSplit({ people, items, taxCents, tipCents, feeCents = 0, discountCents = 0 }) {
  const byId = new Map(
    people.map((p) => [p.id, { id: p.id, name: p.name, lines: [], subtotal: 0, ordered: 0, discount: 0, tax: 0, tip: 0, fee: 0, total: 0 }])
  );

  let itemsTotal = 0;
  let orderedTotal = 0;
  const unassigned = [];

  items.forEach((item, index) => {
    itemsTotal += item.cents;
    if (item.cents > 0) orderedTotal += item.cents;
    const who = people.filter((p) => (item.assigned.get(p.id) || 0) > 0);
    if (who.length === 0) {
      unassigned.push(item);
      return;
    }
    const shares = who.map((p) => Math.max(1, Math.min(9, item.assigned.get(p.id) | 0)));
    const totalShares = shares.reduce((a, b) => a + b, 0);
    const even = shares.every((x) => x === shares[0]);
    const parts = allocateShares(item.cents, shares, index);
    who.forEach((p, k) => {
      const row = byId.get(p.id);
      row.lines.push({
        name: item.name || 'Item',
        cents: parts[k],
        addon: Boolean(item.addon),
        people: who.length,
        shares: shares[k],
        totalShares,
        even,
      });
      row.subtotal += parts[k];
      if (parts[k] > 0) row.ordered += parts[k];
    });
  });

  const rows = [...byId.values()];
  const ordered = rows.map((r) => r.ordered);
  const discParts = allocateProportional(-discountCents, ordered);
  rows.forEach((r, i) => { r.discount = discParts[i]; });
  const afterDiscounts = rows.map((r) => r.subtotal + r.discount);
  const taxParts = allocateProportional(taxCents, afterDiscounts);
  const feeParts = allocateProportional(feeCents, afterDiscounts);
  const tipParts = allocateProportional(tipCents, ordered);
  rows.forEach((r, i) => {
    r.tax = taxParts[i];
    r.fee = feeParts[i];
    r.tip = tipParts[i];
    r.total = r.subtotal + r.discount + r.tax + r.fee + r.tip;
  });

  return {
    rows,
    itemsTotal,
    orderedTotal,
    taxCents,
    tipCents,
    feeCents,
    discountCents,
    grandTotal: itemsTotal - discountCents + taxCents + tipCents + feeCents,
    unassigned,
  };
}

/**
 * Who pays whom. balances: [{ id, cents }] where positive = is owed money,
 * negative = owes money. The biggest debt goes to the biggest refund until
 * everyone is square. Returns [{ from, to, cents }].
 */
export function settleUp(balances) {
  const owed = balances.filter((b) => b.cents > 0).map((b) => ({ ...b })).sort((a, b) => b.cents - a.cents);
  const owes = balances.filter((b) => b.cents < 0).map((b) => ({ id: b.id, cents: -b.cents })).sort((a, b) => b.cents - a.cents);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < owed.length) {
    const cents = Math.min(owes[i].cents, owed[j].cents);
    if (cents > 0) out.push({ from: owes[i].id, to: owed[j].id, cents });
    owes[i].cents -= cents;
    owed[j].cents -= cents;
    if (owes[i].cents === 0) i++;
    if (owed[j].cents === 0) j++;
  }
  return out;
}
