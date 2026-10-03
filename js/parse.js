import { parseMoney } from './split.js';

// Trailing price on a line, optionally followed by a 1–2 letter tax flag ("T", "F", "TX").
// OCR sometimes inserts a space before the cents ("12. 50"), so that's tolerated.
const PRICE_AT_END =
  /(\(|-)?\s?\$?\s?(\d{1,3}(?:,\d{3})+[.,]\s?\d{2}|\d{1,6}[.,]\s?\d{2})\)?(?:\s+[A-Za-z]{1,2})?\s*$/;

const RE = {
  subtotal: /\bsub\s*-?\s*total\b|\bsubtl\b/,
  total: /\b(grand\s+)?total\b|\bamount\s+due\b|\bbalance\b|\btotal\s+due\b/,
  tax: /\b(sales\s+)?tax\b|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\biva\b/,
  tip: /\btip\b|\bgratuity\b|\bservice\s+charge\b/,
  discount: /\bdiscount\b|\bcoupon\b|\bpromo\b|\bcomp\b/,
  skip:
    /\bchange\b|\bcash\b|\btender(ed)?\b|\bvisa\b|\bmaster\s*card\b|\bamex\b|\bdiscover\b|\bcard\b|\bdebit\b|\bcredit\b|\bpayment\b|\bpaid\b|\bauth\b|\bapproval\b|\bsuggested\b|\brounding\b|\bdue\b/,
};

function cleanName(raw) {
  return raw
    .replace(/[.\-_:·•…]{2,}/g, ' ') // dot leaders
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '') // junk at the edges
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Parse raw OCR text.
 * Returns { items: [{ name, cents }], taxCents, tipCents, subtotalCents, totalCents }.
 * Any of the cents fields may be null when the receipt didn't show them.
 */
export function parseReceiptText(text) {
  const out = { items: [], taxCents: null, tipCents: null, subtotalCents: null, totalCents: null };
  if (typeof text !== 'string') return out;

  const lines = text.split(/\r?\n/).slice(0, 400); // a receipt longer than this isn't a receipt

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length < 3) continue;

    const m = line.match(PRICE_AT_END);
    if (!m) continue;

    let cents = parseMoney(m[2].replace(/\s/g, ''));
    if (cents === null) continue;
    if (m[1]) cents = -Math.abs(cents);

    const name = cleanName(line.slice(0, m.index));
    const key = name.toLowerCase();
    if (!/\p{L}{2,}/u.test(name)) continue; // a bare number isn't an item

    if (/\bsuggest/.test(key)) continue; // "suggested tip 20%: $12.00" is not a tip anyone paid

    if (RE.subtotal.test(key)) {
      out.subtotalCents = cents;
    } else if (RE.tax.test(key)) {
      out.taxCents = (out.taxCents ?? 0) + cents;
    } else if (RE.tip.test(key)) {
      out.tipCents = (out.tipCents ?? 0) + cents;
    } else if (RE.total.test(key)) {
      // Keep the largest "total" — receipts often print a pre-tip and post-tip total.
      if (out.totalCents === null || cents > out.totalCents) out.totalCents = cents;
    } else if (RE.skip.test(key)) {
      continue;
    } else if (RE.discount.test(key)) {
      out.items.push({ name, cents: -Math.abs(cents) });
    } else {
      out.items.push({ name, cents });
    }
  }

  return out;
}

/**
 * Rebuild text rows from word boxes. Tesseract sometimes reads a receipt as two
 * columns (all the names, then all the prices). Grouping words by their vertical
 * position puts each price back on the same line as its item.
 * words: [{ text, bbox: { x0, y0, x1, y1 } }]
 */
export function textFromWords(words) {
  const ws = (words || [])
    .filter((w) => w && typeof w.text === 'string' && w.text.trim() && w.bbox)
    .map((w) => ({ text: w.text.trim(), x: w.bbox.x0, yc: (w.bbox.y0 + w.bbox.y1) / 2, h: Math.max(1, w.bbox.y1 - w.bbox.y0) }));
  if (!ws.length) return '';

  const heights = ws.map((w) => w.h).sort((a, b) => a - b);
  const tol = heights[Math.floor(heights.length / 2)] * 0.6;

  ws.sort((a, b) => a.yc - b.yc);
  const rows = [];
  for (const w of ws) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(w.yc - row.yc) <= tol) {
      row.words.push(w);
      row.yc = row.words.reduce((s, x) => s + x.yc, 0) / row.words.length;
    } else {
      rows.push({ yc: w.yc, words: [w] });
    }
  }
  return rows.map((r) => r.words.sort((a, b) => a.x - b.x).map((w) => w.text).join(' ')).join('\n');
}

/** Pull every word out of Tesseract's nested block output. */
export function wordsFromBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

/** Parse both readings and keep whichever looks more like a real receipt. */
export function bestParse(...texts) {
  const score = (r) => {
    const sum = r.items.reduce((s, i) => s + i.cents, 0);
    return r.items.length * 10 + (r.subtotalCents !== null && sum === r.subtotalCents ? 1000 : 0);
  };
  return texts.map(parseReceiptText).reduce((best, r) => (score(r) > score(best) ? r : best));
}
