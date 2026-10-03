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

/**
 * Work out what everyone owes.
 *
 * people:  [{ id, name }]
 * items:   [{ id, name, cents, assigned: Set<personId> }]
 * taxCents, tipCents: integers (cents)
 *
 * Tax and tip are spread across people in proportion to their item subtotal.
 */
export function computeSplit({ people, items, taxCents, tipCents }) {
  const byId = new Map(
    people.map((p) => [p.id, { id: p.id, name: p.name, lines: [], subtotal: 0, tax: 0, tip: 0, total: 0 }])
  );

  let itemsTotal = 0;
  const unassigned = [];

  items.forEach((item, index) => {
    itemsTotal += item.cents;
    const who = people.filter((p) => item.assigned.has(p.id)).map((p) => p.id);
    if (who.length === 0) {
      unassigned.push(item);
      return;
    }
    const shares = splitEven(item.cents, who.length, index);
    who.forEach((pid, k) => {
      const row = byId.get(pid);
      row.lines.push({
        name: item.name || 'Item',
        cents: shares[k],
        sharedWith: who.length,
      });
      row.subtotal += shares[k];
    });
  });

  const rows = [...byId.values()];
  const weights = rows.map((r) => r.subtotal);
  const taxParts = allocateProportional(taxCents, weights);
  const tipParts = allocateProportional(tipCents, weights);
  rows.forEach((r, i) => {
    r.tax = taxParts[i];
    r.tip = tipParts[i];
    r.total = r.subtotal + r.tax + r.tip;
  });

  return {
    rows,
    itemsTotal,
    taxCents,
    tipCents,
    grandTotal: itemsTotal + taxCents + tipCents,
    unassigned,
  };
}
