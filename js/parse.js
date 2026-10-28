import { parseMoney } from './split.js';
import { WORDS } from './words.js';

/*
 * Turns receipt text into items, add-ons, tax, tip, fees and totals.
 *
 * Input is a list of lines: { text, cap?, xh? }.
 *   cap = typical capital-letter height of the line's words (pixels)
 *   xh  = the reader's tilt-corrected lowercase height for the line
 * Size data only exists for photos. Pasted text has none, and every rule that
 * needs size simply doesn't fire without it.
 */

// Price at the end of a line, optionally followed by a tax flag ("T", "F", "TX").
const PRICE_AT_END =
  /(\(|-)?\s?\$?\s?(\d{1,3}(?:,\d{3})+[.,]\s?\d{2}|\d{1,6}[.,]\s?\d{2})\)?(-)?(?:\s+[A-Za-z]{1,2})?\s*$/;
// "$99 25": the reader sometimes turns the decimal point into a space. Only trusted with a $ sign.
const PRICE_SPACED = /\$\s?(\d{1,6})\s(\d{2})(?:\s+[A-Za-z]{1,2})?\s*$/;

const RE = {
  subtotal: /\bsub\s*-?\s*total\b|\bsubtl\b|\bsub\s*ttl\b/,
  total: /\b(grand\s+)?total\b|\bamount(\s+due)?\b|\bbalance(\s+due)?\b|\btotal\s+due\b|\bttl\b/,
  tax: /\b(sales\s+|state\s+|city\s+|county\s+|local\s+|liquor\s+)?tax(es)?\b|\bvat\b|\bgst\b|\bhst\b|\bpst\b|\biva\b/,
  tip: /\btip\b|\bgratuity\b|\bservice\s+charge\b|\bauto[\s-]?grat/,
  fee:
    /\bfees?\b|\bsurcharge\b|\bmandate\b|\bkitchen\s+(appreciation|staff|team)\b|\bwellness\b|\bliving\s+wage\b|\bemployee\s+benefits?\b|\bhealth(care)?\s+(charge|surcharge|mandate|ordinance)\b|\bsf\s*(hm|hcso)\b|\bcrv\b|\bbottle\s+deposit\b|\bconvenience\b|\bprocessing\b/,
  discount: /\bdiscount\b|\bcoupon\b|\bpromo\b|\bcomp(ed)?\b|\bhappy\s+hour\b|\boff\b|\bloyalty\b|\breward\b/,
  void: /\bvoid(ed)?\b|\bcancel(l?ed)?\b|\bdeleted\b|\brefund(ed)?\b/,
  vatIncluded: /\bincl(\.|uded|udes)?\b.*\b(vat|tax|gst|mwst|tva|iva)\b|\b(vat|tax|gst)\b.*\bincl/,
  tipGuide: /\bsuggest|\b(tip|gratuity)\s+guide\b/,
  skip:
    /\bchange\b|\bcash\b|\btender(ed)?\b|\bvisa\b|\bmaster\s*card\b|\bamex\b|\bdiscover\b|\bcard\b|\bdebit\b|\bcredit\b|\bpayment\b|\bpaid\b|\bauth\b|\bapproval\b|\brounding\b|\bcheck\s*#|\border\s*#/,
  cardSlip: /\bvisa\b|\bmaster\s*card\b|\bamex\b|\bdiscover\b|\bauth\b|\bapproval\b|\bsignature\b|\bcontactless\b|\bchip\b/,
};

const ADDON_SYMBOL = /^[-+*>~•·]\s*(?=\p{L})/u;
const ADDON_WORD = /^(?:(?:add|added|extra|xtra|sub|substitute|with|side\s+of|no)\b|w\/)/i;
const QTY_PREFIX = /^(\d{1,2})\s*[xX×]?\s+(?=[\p{L}\-+*>~(])/u;
const QTY_SUFFIX = /\s+[xX×]\s?(\d{1,2})$/;
const UNIT_PRICE = /\s*(?:(\d{1,2})\s*)?(?:@|[xX×]\s*\$)\s*\$?\d{1,4}[.,]\d{2}\s*(?:ea\.?|each)?$/i;

// Size comparisons. "Same" is a tight band so only lines that clearly match get joined.
// cap = word-box height (good on level photos, unreliable once the photo is tilted)
// xh  = the reader's tilt-corrected lowercase height (good either way)
const CAP_SAME = [0.9, 1.1];
const XH_SAME = [0.92, 1.09];
const CAP_SMALL = 0.82;
const XH_SMALL = 0.88;
const XH_SMALL_TILTED = 0.85;
const TILT = 0.02; // baseline slope beyond which word boxes stop being trustworthy (about 1 degree)

/* --------------------------------------------------------------- spelling */

const AMBIG = new Set(['l', 'i', '1', '|', 'I']);

function applyCase(src, fixed) {
  // Judge case by the letters the reader is sure about, not the i/l it mixed up.
  const sure = src.replace(/[lIi1|]/g, '');
  if (sure && sure === sure.toUpperCase()) return fixed.toUpperCase();
  if (src[0] === src[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

/** Repair i/l mix-ups using the menu word list. Leaves anything it isn't sure about. */
export function fixWord(word) {
  const m = word.match(/^([^\p{L}\d|]*)([\p{L}\d|]+)([^\p{L}\d|]*)$/u);
  if (!m) return word;
  const [, pre, core, post] = m;
  if (core.length < 3 || core.length > 16 || !/\p{L}/u.test(core)) return word;
  if (/\d/.test(core.replace(/1/g, ''))) return word; // real numbers stay put
  const lower = core.toLowerCase();
  if (WORDS.has(lower)) return word;

  const spots = [];
  for (let i = 0; i < core.length; i++) if (AMBIG.has(core[i])) spots.push(i);
  if (spots.length === 0 || spots.length > 5) return word;

  const chars = lower.split('');
  for (let mask = 0; mask < 1 << spots.length; mask++) {
    spots.forEach((pos, k) => { chars[pos] = mask & (1 << k) ? 'i' : 'l'; });
    const candidate = chars.join('');
    if (WORDS.has(candidate)) return pre + applyCase(core.replace(/[1|]/g, 'l'), candidate) + post;
  }
  return word;
}

export const fixSpelling = (text) => text.split(' ').map(fixWord).join(' ');

/* ------------------------------------------------------------------ helpers */

function cleanName(raw) {
  return raw
    .replace(/[.\-_:·•…]{2,}/g, ' ')
    .replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{N})]+$/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Split a line into label and price. Returns { label, cents } with cents null when there's no price. */
function splitPrice(line) {
  let m = line.match(PRICE_AT_END);
  if (m) {
    let cents = parseMoney(m[2].replace(/\s/g, ''));
    if (cents !== null) {
      if (m[1] || m[3]) cents = -Math.abs(cents);
      return { label: line.slice(0, m.index).trim(), cents };
    }
  }
  m = line.match(PRICE_SPACED);
  if (m) {
    const cents = parseMoney(`${m[1]}.${m[2]}`);
    if (cents !== null) return { label: line.slice(0, m.index).trim(), cents };
  }
  return { label: line, cents: null };
}

/** Pull quantity and unit-price clutter off a label. */
function takeQuantity(label) {
  let qty = 1;
  let s = label;
  const unit = s.match(UNIT_PRICE);
  if (unit) {
    if (unit[1]) qty = Number(unit[1]);
    s = s.slice(0, unit.index).trim();
  }
  const misread = s.match(/^(?:[lI|]|il|li|1l|l1)\s+(?=\p{Lu})/u); // the reader's take on a "1"
  if (misread) {
    s = s.slice(misread[0].length);
    return { qty: 1, rest: s.trim(), hadQty: true };
  }
  const pre = s.match(QTY_PREFIX);
  if (pre) {
    qty = Number(pre[1]);
    s = s.slice(pre[0].length);
  }
  const suf = s.match(QTY_SUFFIX);
  if (suf) {
    qty = Number(suf[1]);
    s = s.slice(0, suf.index);
  }
  if (!(qty >= 1 && qty <= 20)) qty = 1;
  return { qty, rest: s.trim(), hadQty: Boolean(pre || suf || (unit && unit[1])) };
}

const ratio = (a, b) => (a && b ? a / b : null);
const within = (r, [lo, hi]) => r !== null && r >= lo && r <= hi;

/** Page tilt from the longer lines; short lines give noisy angles. */
function pageTilt(lines) {
  const slopes = lines
    .filter((l) => typeof l.slope === 'number' && String(l.text || '').length >= 12)
    .map((l) => l.slope)
    .sort((a, b) => a - b);
  return slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
}

/* ------------------------------------------------------------------- parser */

/**
 * Parse receipt lines.
 * Returns {
 *   items: [{ name, cents (int|null), qty, addon, parent (index|null), joined ({ base, extra }|null) }],
 *   taxCents, tipCents, feeCents, subtotalCents, totalCents, gratuity, cardSlip
 * } with any figure null when the receipt didn't show it.
 */
export function parseLines(input) {
  const out = {
    items: [], taxCents: null, tipCents: null, feeCents: null,
    subtotalCents: null, totalCents: null, gratuity: false, cardSlip: false,
  };
  if (!Array.isArray(input)) return out;

  let itemsStarted = false;
  let footer = false; // after the subtotal/total, only charges and totals count
  let lastItem = -1; // index into out.items of the last real (non add-on) item
  let lastItemLine = null; // its size data
  let prevWasLastItem = false; // was the line just before this one that item?
  let tipLines = 0;
  let paymentWords = false;
  const tilt = Math.abs(pageTilt(input)) > TILT;

  for (const raw of input.slice(0, 400)) {
    const line = fixSpelling(String(raw.text ?? '').replace(/\s+/g, ' ').replace(/^\|+\s*/, '').trim());
    const wasAfterItem = prevWasLastItem;
    prevWasLastItem = false;
    if (line.length < 2) continue;

    const { label: rawLabel, cents } = splitPrice(line);
    const key = rawLabel.toLowerCase();
    if (RE.cardSlip.test(key)) paymentWords = true;

    // Things that are never items, priced or not.
    if (RE.void.test(key) || RE.vatIncluded.test(key)) continue;
    if (RE.tipGuide.test(key) || /^\$?\d{1,2}(\.\d{1,2})?\s?%/.test(rawLabel)) continue;

    if (cents !== null) {
      if (RE.subtotal.test(key)) { out.subtotalCents = cents; footer = true; continue; }
      if (RE.tax.test(key)) { out.taxCents = (out.taxCents ?? 0) + cents; continue; }
      if (RE.tip.test(key)) {
        out.tipCents = (out.tipCents ?? 0) + cents;
        tipLines += 1;
        if (/gratuity|service|auto/.test(key)) out.gratuity = true;
        continue;
      }
      if (RE.fee.test(key)) { out.feeCents = (out.feeCents ?? 0) + cents; continue; }
      if (RE.total.test(key)) {
        if (out.totalCents === null || cents > out.totalCents) out.totalCents = cents;
        footer = true;
        continue;
      }
      if (RE.skip.test(key)) continue;
    }

    const { qty, rest, hadQty } = takeQuantity(rawLabel);
    const symbol = ADDON_SYMBOL.test(rest);
    const name = cleanName(rest.replace(ADDON_SYMBOL, ''));
    if (!/\p{L}{2,}/u.test(name)) continue;

    const capR = tilt ? null : ratio(raw.cap, lastItemLine?.cap);
    const xhR = ratio(raw.xh, lastItemLine?.xh);
    const clearlySmaller = xhR !== null && (tilt ? xhR <= XH_SMALL_TILTED : capR !== null && capR <= CAP_SMALL && xhR <= XH_SMALL);
    // Joining needs the tilt-proof measure to match, plus the word-box measure when the photo is level.
    const sameSize = within(xhR, XH_SAME) && (tilt || within(capR, CAP_SAME));

    if (cents !== null) {
      if (footer) {
        // A discount printed after the subtotal still counts. Anything else down here isn't food.
        if (RE.discount.test(key)) out.items.push({ name, cents: -Math.abs(cents), qty: 1, addon: false, parent: null, joined: null });
        continue;
      }
      if (RE.discount.test(key) && !symbol) {
        out.items.push({ name, cents: -Math.abs(cents), qty: 1, addon: false, parent: null, joined: null });
        continue;
      }

      const isAddon = lastItem !== -1 && (symbol || ADDON_WORD.test(rest) || clearlySmaller);
      if (isAddon) {
        if (cents === 0) continue; // a free modifier is a cooking note, not a charge
        out.items.push({ name, cents, qty, addon: true, parent: lastItem, joined: null });
        continue;
      }

      itemsStarted = true;
      out.items.push({ name, cents, qty, addon: false, parent: null, joined: null });
      lastItem = out.items.length - 1;
      lastItemLine = raw;
      prevWasLastItem = true;
      continue;
    }

    // ---- lines without a price ----
    if (!itemsStarted || footer) continue;
    if (symbol || ADDON_WORD.test(rest)) continue; // unpriced modifier: cooking note

    // A quantity up front means a new item whose price the reader lost.
    // If sizes are known it has to be dish-sized; a smaller "8 Pcs California Roll" is a description.
    if (hadQty && (xhR === null || xhR >= XH_SAME[0]) && !clearlySmaller) {
      out.items.push({ name, cents: null, qty, addon: false, parent: null, joined: null });
      lastItem = out.items.length - 1;
      lastItemLine = raw;
      prevWasLastItem = true;
      continue;
    }

    // Second line of a long dish name: right after its dish, same text size by both measures.
    const target = out.items[lastItem];
    if (wasAfterItem && target && !target.joined && !hadQty && name.length <= 30 && sameSize) {
      target.joined = { base: target.name, extra: name };
      target.name = `${target.name} ${name}`.slice(0, 60);
      prevWasLastItem = false;
      continue;
    }
    // Anything else without a price is a description, header or footer line.
  }

  // Two or more tip lines are a tip guide ("18% ... 20% ..."), not a tip anyone added.
  if (tipLines >= 2 && !out.gratuity) out.tipCents = null;
  if (out.items.length === 0 && paymentWords && (out.totalCents !== null || out.tipCents !== null)) out.cardSlip = true;

  return out;
}

/** Plain text (pasted, or the reader's flat output) has no size data. */
export function parseReceiptText(text) {
  if (typeof text !== 'string') return parseLines([]);
  return parseLines(text.split(/\r?\n/).map((t) => ({ text: t })));
}

/* ---------------------------------------------------- reader output helpers */

const NO_CAP = /[gjpqy()[\]{},;$]/; // letters and marks that stick out below or above a capital

function capHeight(words) {
  const hs = words
    .filter((w) => /\p{L}{2,}/u.test(w.text) && !/\d/.test(w.text) && !NO_CAP.test(w.text) && /[A-Zbdfhiklt]/.test(w.text))
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .sort((a, b) => a - b);
  if (!hs.length) return null;
  return hs[Math.floor(hs.length / 2)];
}

/** Lines as the reader saw them, with size data for each. */
export function linesFromBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const words = (l.words || []).filter((w) => w && w.bbox && typeof w.text === 'string');
    const ra = l.rowAttributes || {};
    const xh = ra.rowHeight && ra.ascenders !== undefined && ra.descenders !== undefined
      ? ra.rowHeight - ra.ascenders - ra.descenders
      : null;
    const bl = l.baseline;
    const slope = bl && bl.x1 > bl.x0 ? (bl.y1 - bl.y0) / (bl.x1 - bl.x0) : 0;
    out.push({
      text: words.map((w) => w.text.trim()).filter(Boolean).join(' ') || String(l.text || '').trim(),
      cap: capHeight(words), xh: xh > 0 ? xh : null, slope,
    });
  }
  return out;
}

/** Pull every word out of the reader's nested block output. */
export function wordsFromBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

/**
 * Rebuild text rows from word boxes. The reader sometimes reads a receipt as two
 * columns (all the names, then all the prices). Grouping words by height on the
 * page puts each price back on its item's line.
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

/** How receipt-like a parse looks. Matching the subtotal beats everything. */
export function scoreParse(r) {
  const priced = r.items.filter((i) => i.cents !== null);
  const sum = priced.reduce((s, i) => s + i.cents, 0);
  const matches = r.subtotalCents !== null && sum === r.subtotalCents && priced.length === r.items.length;
  return (matches ? 10000 : 0) + priced.length * 10 - (r.items.length - priced.length) * 3;
}

/** Parse several readings (strings or line lists) and keep the one that looks most like the receipt. */
export function bestParse(...inputs) {
  return inputs
    .map((x) => (typeof x === 'string' ? parseReceiptText(x) : parseLines(x)))
    .reduce((best, r) => (scoreParse(r) > scoreParse(best) ? r : best));
}

/* ------------------------------------------------------------------- paste */

const PRICE_ONLY = /^[-(]?\s?\$?\s?\d{1,6}[.,]\s?\d{2}\)?(?:\s+[A-Za-z]{1,2})?$/;

/**
 * Copied text (e.g. from Google Lens) often comes out as a block of item names
 * followed by a block of prices. Re-pair them line by line. When there are more
 * names than prices, the extras are assumed to be header lines at the top.
 */
export function pairColumns(text) {
  if (typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const isPrice = (l) => PRICE_ONLY.test(l);
  const isLabel = (l) => !isPrice(l) && /\p{L}{2,}/u.test(l) && !PRICE_AT_END.test(l);

  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isLabel(lines[i])) { out.push(lines[i]); i++; continue; }

    let j = i;
    while (j < lines.length && isLabel(lines[j])) j++;
    let k = j;
    while (k < lines.length && isPrice(lines[k])) k++;

    const labels = lines.slice(i, j);
    const prices = lines.slice(j, k);
    if (prices.length > 0 && labels.length >= prices.length) {
      const extra = labels.length - prices.length;
      out.push(...labels.slice(0, extra));
      prices.forEach((p, n) => out.push(`${labels[extra + n]} ${p}`));
      i = k;
    } else {
      out.push(...labels);
      i = j;
    }
  }
  return out.join('\n');
}
