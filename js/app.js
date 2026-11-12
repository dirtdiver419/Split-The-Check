import { parseMoney, parsePercent, formatMoney, centsToInput, computeSplit, splitEven, settleUp } from './split.js';
import { bestParse, pairColumns, textFromWords, wordsFromBlocks, linesFromBlocks, scoreParse } from './parse.js';
import { CHARGE_RE } from './charges.js';

// Everything lives in this object, in memory only. No localStorage, no cookies,
// no IndexedDB, no network writes. Refreshing the page wipes it.
const state = {
  people: [], // { id, name }
  payerIds: new Set(),
  pay: new Map(), // personId -> { paid, mode: 'percent'|'amount'|'total', pct, amt, total } (raw text)
  items: [], // see makeItem()
  tipMode: 'percent',
  receipt: { subtotalCents: null, totalCents: null },
  gratuityFromReceipt: false,
  discNames: [], // names of discounts moved into the Discounts field
  photo: null, // the picked File, kept in memory only so it can be cropped
  previewUrl: null,
  rotation: 0,
  crop: null, // { x, y, w, h } as fractions of the rotated photo
  scanToken: 0,
  history: [], // [{ snap, text }], newest last, for Undo
  undoTimer: 0,
  undoSticky: false, // stays up until the next tap (after Scan again)
  undoHover: false,
  keyboardUser: false,
  taxes: [], // { id, name, raw, inSubtotal } rows in the Tax list (raw = text in the amount box)
  fees: [], // { id, name, raw, even, inSubtotal } rows in the Fees list
  tipEven: false,
  lastRead: null, // how the current photo was last read, for Scan again
  receiptShown: false,
  editing: null, // 'subtotalCents' | 'totalCents' while that receipt figure is being edited
  wasDone: false, // last results check found nothing missing
};

const LIMITS = { people: 30, items: 150, nameLen: 30, itemLen: 60, fileBytes: 25 * 1024 * 1024, pasteChars: 20000, maxShares: 9 };

let idCounter = 0;
const newId = () => `id${++idCounter}`;

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const listAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const personName = (id) => state.people.find((p) => p.id === id)?.name ?? '';

/** Build a DOM node. Strings become text nodes, never HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

/** Lists are rebuilt on every change. Buttons carry a data-key so focus can land back on the same one. */
const focusKey = () => document.activeElement?.dataset?.key || null;
function restoreFocus(key) {
  if (!key) return false;
  const target = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!target) return false;
  if (target.disabled) {
    const sibling = target.parentElement?.querySelector('button:not([disabled])');
    if (sibling) sibling.focus();
    return Boolean(sibling);
  }
  target.focus();
  return true;
}
function keepFocus(render) {
  const key = focusKey();
  render();
  restoreFocus(key);
}

const cleanText = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/* --------------------------------------------------------- money box errors */

/** "$", "." or "-" on their own are an amount still being typed, not a mistake. */
const halfTyped = (t) => /^[\s$.\-]*$/.test(t);
/** True when a money box holds something that can't be read as an amount. */
const badMoney = (raw, { negative = true } = {}) => {
  const t = String(raw).trim();
  if (halfTyped(t)) return false;
  const c = parseMoney(t);
  return c === null || (!negative && c < 0);
};
const badPct = (raw) => {
  const t = String(raw).trim();
  return !halfTyped(t) && parsePercent(t) === null;
};

/**
 * Red outline and a message under the box as soon as its text can't be an amount.
 * The message sits after the box, so the box itself never moves while someone types in it.
 * Screen readers get it through aria-describedby, and hear it once when they leave the box.
 */
function guard(input, err, check) {
  const update = () => {
    const msg = check(input.value);
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    if (err.textContent !== msg) err.textContent = msg;
    err.hidden = !msg;
    if (msg) input.setAttribute('aria-describedby', err.id);
    else input.removeAttribute('aria-describedby');
  };
  input.addEventListener('input', update);
  input.addEventListener('blur', () => { if (!err.hidden) announce(err.textContent); });
  update();
  return update;
}

/* ------------------------------------------------------------------- model */

/**
 * item = {
 *   id, name, cents (int | null), rawPrice,
 *   assigned: Map<personId, shares>, uneven,
 *   addon, parentId, open (add-on editor shown),
 *   joined: { base, extra } | null, qty, qtyGuess,
 *   guess: null | 'guessed' | 'added'   (price came from the subtotal, not confirmed yet)
 *   afterSubtotal (a discount or charge printed below the subtotal; not part of the subtotal check)
 * }
 * Add-ons always follow their dish's people. They never have people of their own.
 */
function makeItem({ name = '', cents = null, qty = 1, qtyGuess = false, addon = false, parentId = null, joined = null, afterSubtotal = false } = {}) {
  return {
    id: newId(), name: cleanText(name, LIMITS.itemLen), cents, rawPrice: '',
    assigned: new Map(), uneven: false,
    addon, parentId, open: false,
    joined, qty, qtyGuess, guess: null, afterSubtotal,
    menuOpen: false, splitN: null,
  };
}

const byId = (id) => state.items.find((i) => i.id === id);
const addonsOf = (item) => state.items.filter((i) => i.addon && i.parentId === item.id);
const isTop = (item) => !item.addon || !byId(item.parentId);
const topItems = () => state.items.filter(isTop);

/** A top-level row with no name and no price is a placeholder, not an item. */
const isBlank = (item) => isTop(item) && !item.name && item.cents === null && !item.rawPrice;
const realItems = () => state.items.filter((i) => !isBlank(i));

function syncAddons(parent) {
  for (const a of addonsOf(parent)) {
    a.assigned = new Map(parent.assigned);
    a.uneven = parent.uneven;
  }
}

function setShares(item, pid, n) {
  if (n <= 0) item.assigned.delete(pid);
  else item.assigned.set(pid, Math.min(LIMITS.maxShares, n));
  if (item.assigned.size < 2) {
    item.uneven = false;
    for (const k of item.assigned.keys()) item.assigned.set(k, 1);
  }
  syncAddons(item);
}

/** Index just past a dish and all of its add-ons in state.items. */
function blockEnd(parent) {
  let end = state.items.indexOf(parent);
  state.items.forEach((i, idx) => { if (i.addon && i.parentId === parent.id && idx > end) end = idx; });
  return end + 1;
}

function moveAfter(rows, parent) {
  state.items = state.items.filter((i) => !rows.includes(i));
  state.items.splice(blockEnd(parent), 0, ...rows);
}

/* -------------------------------------------------------------------- undo */

function cloneItem(i) {
  return { ...i, assigned: new Map(i.assigned), joined: i.joined ? { ...i.joined } : null };
}

function snapshot() {
  return {
    people: state.people.map((p) => ({ ...p })),
    payerIds: new Set(state.payerIds),
    pay: new Map([...state.pay].map(([k, v]) => [k, { ...v }])),
    items: state.items.map(cloneItem),
    taxes: state.taxes.map((r) => ({ ...r })),
    fees: state.fees.map((r) => ({ ...r })),
    receipt: { ...state.receipt },
    tipEven: state.tipEven,
    tipMode: state.tipMode,
    tip: { pct: $('tip-pct').value, amt: $('tip-amt').value, total: $('tip-total').value },
    gratuity: state.gratuityFromReceipt,
    disc: $('disc').value,
    discShown: !$('disc-wrap').hidden,
    discNames: [...state.discNames],
    note: $('receipt-note').textContent,
    focusKey: focusKey(),
  };
}

const UNDO_MS = 7000;
const HISTORY_MAX = 20;

/** Add a step to the history and show the toast. Call it before changing anything. */
function remember(text, { snap = snapshot(), sticky = false } = {}) {
  state.history.push({ snap, text });
  if (state.history.length > HISTORY_MAX) state.history.shift();
  state.undoSticky = sticky;
  $('undo-text').textContent = text;
  $('undo-bar').hidden = false;
  armUndo();
  renderUndoButton();
}

const keyboardOpen = () => {
  const vv = window.visualViewport;
  const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  return Boolean(vv && typing && window.innerHeight - vv.height > 150);
};

/** The toast waits while it's touched or focused, while the on-screen keyboard is up,
    and for anyone moving around with a keyboard. Otherwise it goes after 7 seconds. */
function armUndo() {
  clearTimeout(state.undoTimer);
  if ($('undo-bar').hidden || state.undoSticky) return;
  const held = state.undoHover || state.keyboardUser || keyboardOpen() || $('undo-bar').contains(document.activeElement);
  if (!held) state.undoTimer = setTimeout(hideUndo, UNDO_MS);
}

/** Hides the toast. The steps stay in the history for the Undo button at the bottom. */
function hideUndo() {
  clearTimeout(state.undoTimer);
  state.undoSticky = false;
  $('undo-bar').hidden = true;
  $('undo-text').textContent = '';
}

/** The Undo button above Start over, with what it would undo. */
function renderUndoButton() {
  const steps = state.history;
  $('undo-wrap').hidden = !steps.length;
  if (!steps.length) return;
  const more = steps.length - 1;
  $('undo-what').textContent = `Undoes: ${steps[steps.length - 1].text}`;
  $('undo-more').textContent = more ? `${more} more step${more === 1 ? '' : 's'} after that` : '';
}

/** A polite message for screen readers. */
function announce(text) {
  const out = $('sr-status');
  out.textContent = '';
  setTimeout(() => { out.textContent = text; }, 50);
}

function undo({ fromButton = false } = {}) {
  const step = state.history.pop();
  if (!step) return;
  const snap = step.snap;
  state.people = snap.people;
  state.payerIds = snap.payerIds;
  state.pay = snap.pay;
  state.items = snap.items;
  state.taxes = snap.taxes;
  state.fees = snap.fees;
  state.receipt = snap.receipt;
  state.tipEven = snap.tipEven;
  state.discNames = snap.discNames;
  state.gratuityFromReceipt = snap.gratuity;
  state.editing = null;
  $('disc').value = snap.disc;
  $('tip-pct').value = snap.tip.pct;
  $('tip-amt').value = snap.tip.amt;
  $('tip-total').value = snap.tip.total;
  $('receipt-note').textContent = snap.note;
  showDisc(snap.discShown);
  syncTipPresets();
  hideUndo();
  setTipMode(snap.tipMode);
  renderAll();
  renderUndoButton();
  if (fromButton) {
    // Stay at the bottom of the page instead of jumping back up to where the change was made.
    if (state.history.length) $('undo-step').focus();
    else $('reset').focus();
    announce(`Undone: ${step.text}`);
  } else {
    restoreFocus(snap.focusKey);
  }
}

/* ------------------------------------------------------------------ people */

function payEntry(pid) {
  if (!state.pay.has(pid)) state.pay.set(pid, { paid: '', mode: 'percent', pct: '20', amt: '', total: '' });
  return state.pay.get(pid);
}

function addPerson() {
  const input = $('person-name');
  let name = cleanText(input.value, LIMITS.nameLen);
  if (!name) { input.focus(); return; }
  if (state.people.length >= LIMITS.people) return;

  const taken = new Set(state.people.map((p) => p.name.toLowerCase()));
  if (taken.has(name.toLowerCase())) {
    let n = 2;
    while (taken.has(`${name} ${n}`.toLowerCase())) n++;
    name = `${name} ${n}`;
  }

  const person = { id: newId(), name };
  state.people.push(person);
  if (state.people.length === 1) state.payerIds.add(person.id);
  input.value = '';
  input.focus();
  renderAll();
}

function removePerson(id) {
  remember(`Removed ${personName(id)}`);
  const at = state.people.findIndex((p) => p.id === id);
  const next = state.people[at + 1] || state.people[at - 1];
  state.people = state.people.filter((p) => p.id !== id);
  state.payerIds.delete(id);
  state.pay.delete(id);
  topItems().forEach((item) => setShares(item, id, 0));
  renderAll();
  if (!(next && restoreFocus(`payer:${next.id}`))) $('person-name').focus();
}

function togglePayer(id) {
  if (state.payerIds.has(id)) state.payerIds.delete(id);
  else { state.payerIds.add(id); payEntry(id); }
  renderPeople();
  renderPayers();
  renderResults();
}

function renderPeople() { keepFocus(drawPeople); }
function drawPeople() {
  $('people').replaceChildren(
    ...state.people.map((p) => {
      const paid = state.payerIds.has(p.id);
      return el('li', { class: 'person' },
        el('span', { class: 'person-name', text: p.name }),
        el('button', {
          type: 'button', class: 'payer-btn', 'aria-pressed': String(paid), 'aria-label': `${p.name} paid`, 'data-key': `payer:${p.id}`,
          text: paid ? 'Paid' : 'Mark as payer', onclick: () => togglePayer(p.id),
        }),
        el('button', { type: 'button', class: 'x-btn', 'aria-label': `Remove ${p.name}`, text: '×', 'data-key': `x:${p.id}`, onclick: () => removePerson(p.id) })
      );
    })
  );
  $('person-add').disabled = state.people.length >= LIMITS.people;
}

/* ------------------------------------------------------------------- items */

function focusItem(id, field = 0) {
  document.querySelectorAll(`[data-item="${id}"] > .item-top input, [data-item="${id}"] > .item-price input`)[field]?.focus();
}

function addItem(name = '', cents = null) {
  const tops = topItems();
  const last = tops[tops.length - 1];
  if (!name && cents === null && last && isBlank(last)) {
    focusItem(last.id);
    return last;
  }
  if (state.items.length >= LIMITS.items) return null;
  const item = makeItem({ name, cents });
  state.items.push(item);
  renderItems();
  renderResults();
  focusItem(item.id);
  return item;
}

const itemLabel = (i) => i.name || (i.cents === null ? 'an unnamed item' : `the ${formatMoney(i.cents)} item`);

function removeItem(id, { silent = false } = {}) {
  const item = byId(id);
  if (!item) return;
  if (!silent) remember(`Removed ${item.name || (item.addon ? 'an add-on' : 'an item')}`);
  const tops = topItems();
  const at = tops.indexOf(item);
  const next = at >= 0 ? tops[at + 1] || tops[at - 1] : byId(item.parentId);
  // Add-ons of a removed dish stay on the bill as their own rows.
  for (const a of addonsOf(item)) { a.addon = false; a.parentId = null; a.open = false; a.assigned = new Map(); a.uneven = false; }
  state.items = state.items.filter((i) => i.id !== id);
  renderItems();
  renderResults();
  if (!silent) {
    const field = next && document.querySelector(`[data-item="${next.id}"] input`);
    (field || $('item-add')).focus();
  }
}

function addAddon(parent) {
  if (state.items.length >= LIMITS.items) return;
  const a = makeItem({ addon: true, parentId: parent.id });
  a.open = true;
  state.items.splice(blockEnd(parent), 0, a);
  syncAddons(parent);
  renderItems();
  renderResults();
  document.querySelector(`.addon[data-item="${a.id}"] input`)?.focus();
}

function makeAddonOf(item, parent) {
  remember(`Made ${itemLabel(item)} an add-on of ${parent.name || 'the item above'}`);
  // Its own people are dropped: an add-on always follows its dish.
  const own = addonsOf(item);
  item.addon = true;
  item.parentId = parent.id;
  item.joined = null;
  item.qty = 1;
  item.qtyGuess = false;
  item.open = false;
  item.menuOpen = false;
  for (const a of own) a.parentId = parent.id; // add-ons are one level deep
  moveAfter([item, ...own], parent);
  syncAddons(parent);
  renderItems();
  renderResults();
  restoreFocus(`addon:${item.id}`);
}

function makeOwnItem(addon) {
  remember(`Made ${itemLabel(addon)} its own item`);
  const parent = byId(addon.parentId);
  addon.addon = false;
  addon.parentId = null;
  addon.open = false;
  addon.assigned = new Map();
  addon.uneven = false;
  if (parent) moveAfter([addon], parent);
  renderItems();
  renderResults();
  focusItem(addon.id);
}

function splitApart(item) {
  if (!item.joined) return;
  remember(`Split ${itemLabel(item)} apart`);
  const { base, extra } = item.joined;
  const suffix = ` ${extra}`;
  if (item.name.endsWith(suffix)) item.name = item.name.slice(0, -suffix.length);
  else if (item.name === `${base}${suffix}`.slice(0, LIMITS.itemLen)) item.name = base;
  item.joined = null;
  const row = makeItem({ name: extra });
  state.items.splice(blockEnd(item), 0, row);
  renderItems();
  renderResults();
  focusItem(row.id, 1);
}

const shownQty = (item) => (item.qtyGuess ? 1 : item.qty);
/** "2× Caesar Salad" for slips and copied text; quantity 1 isn't shown. */
const qtyName = (item) => `${shownQty(item) > 1 ? `${item.qty}× ` : ''}${item.name || 'Item'}`;

function setQty(item, n) {
  remember(`Changed the quantity of ${itemLabel(item)}`);
  item.qty = Math.max(1, Math.min(20, n));
  item.qtyGuess = false;
  renderItems();
  renderResults();
}

/** Turns a dish's add-ons into rows of their own (nobody assigned), before the dish becomes a charge or a discount. */
function detachAddons(item) {
  for (const a of addonsOf(item)) {
    a.addon = false; a.parentId = null; a.open = false; a.menuOpen = false; a.assigned = new Map(); a.uneven = false;
  }
}

/** " · Crispy Shrimp is now its own item", for the toast. */
function detachNote(item) {
  const own = item.addon ? [] : addonsOf(item);
  if (!own.length) return '';
  const names = listAnd(own.map((a) => a.name || 'an add-on'));
  return ` · ${names} ${own.length === 1 ? 'is now its own item' : 'are now their own items'}`;
}

function flipSign(item) {
  if (!item.cents) return;
  const toDiscount = item.cents > 0;
  remember(`Made ${itemLabel(item)} ${toDiscount ? 'a discount' : 'a regular item'}${toDiscount ? detachNote(item) : ''}`);
  if (toDiscount) detachAddons(item);
  item.cents = -item.cents;
  item.afterSubtotal = false;
  renderItems(); // the menu stays open so focus stays on the choice just made
  renderResults();
}

const splitQuantity = (item) => splitRows(item, item.qty);

/** Options → Move this item ↑ ↓. Add-ons travel with their dish. */
function moveItem(item, dir) {
  const tops = topItems();
  const at = tops.indexOf(item);
  const other = tops[at + dir];
  if (at < 0 || !other) return;
  const order = [...tops];
  order[at] = other;
  order[at + dir] = item;
  const next = order.flatMap((t) => [t, ...addonsOf(t)]);
  if (next.length !== state.items.length) return;
  remember(`Moved ${itemLabel(item)} ${dir < 0 ? 'up' : 'down'}`);
  state.items = next;
  renderItems();
  renderResults();
}

/** One row becomes `n` rows with the same name, the price split evenly to the cent. */
function splitRows(item, n) {
  if (n < 2 || state.items.length + n - 1 > LIMITS.items) return;
  remember(`Split ${itemLabel(item)} into ${n} rows`);
  if (item.qtyGuess && n === item.qty) item.name = item.name.replace(/^\d{1,2}\s*/, ''); // "7 Layer Dip" x7 -> "Layer Dip"
  const parts = item.cents === null ? new Array(n).fill(null) : splitEven(item.cents, n);
  const copies = parts.map((c, k) => (k === 0 ? item : makeItem({ name: item.name, cents: c })));
  item.cents = parts[0];
  item.qty = 1;
  item.qtyGuess = false;
  item.menuOpen = false;
  item.splitN = null;
  item.assigned = new Map();
  item.uneven = false;
  syncAddons(item);
  state.items.splice(blockEnd(item), 0, ...copies.slice(1));
  renderItems();
  renderResults();
  restoreFocus(`opt:${item.id}`);
}

/** Name and price inputs, shared by dishes and opened add-ons. */
function itemInputs(item, label) {
  const nameInput = el('input', {
    type: 'text', value: item.name, maxlength: LIMITS.itemLen, autocomplete: 'off',
    placeholder: item.guess === 'added' ? 'What was it?' : item.addon ? 'Add-on' : 'Item', enterkeyhint: 'next', 'aria-label': `${label} name`,
  });
  const priceInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', enterkeyhint: item.addon ? 'done' : 'next',
    value: item.cents === null ? item.rawPrice : centsToInput(item.cents), 'aria-label': `${label} price`,
  });
  const priceErr = el('p', { class: 'field-error', id: `err-${item.id}`, hidden: true });
  guard(priceInput, priceErr, (v) => (badMoney(v) ? 'The price doesn’t look like a dollar amount.' : ''));

  nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    priceInput.focus();
  });
  nameInput.addEventListener('input', () => {
    item.name = cleanText(nameInput.value, LIMITS.itemLen);
    renderResults();
  });

  priceInput.addEventListener('input', () => {
    const cents = parseMoney(priceInput.value);
    item.cents = cents;
    item.rawPrice = priceInput.value.trim().slice(0, 20);
    renderCheck();
    renderPayerCalcs();
    renderResults();
  });
  priceInput.addEventListener('change', () => {
    // Typing a price yourself counts as checking it.
    if (item.guess) { item.guess = null; renderItems(); renderResults(); }
  });
  priceInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const hadGuess = Boolean(item.guess);
    item.guess = null;
    if (item.addon) { closeAddon(item); return; }
    if (hadGuess) { renderItems(); renderResults(); }
    const tops = topItems();
    const next = tops[tops.indexOf(item) + 1];
    if (next) focusItem(next.id);
    else if (!isBlank(item)) addItem();
  });
  priceInput.addEventListener('blur', () => {
    if (item.cents !== null) priceInput.value = centsToInput(item.cents);
  });

  return { nameInput, priceInput, priceErr };
}

function closeAddon(addon) {
  const kept = addon.name || addon.cents !== null || addon.rawPrice;
  if (kept) { addon.open = false; addon.menuOpen = false; }
  else state.items = state.items.filter((i) => i !== addon); // an empty add-on is just discarded
  renderItems();
  renderResults();
  if (!(kept && restoreFocus(`addon:${addon.id}`))) restoreFocus(`opt:${addon.parentId}`);
}

function sharesNote(item) {
  const total = [...item.assigned.values()].reduce((a, b) => a + b, 0);
  if (!total) return '';
  const parts = state.people
    .filter((p) => item.assigned.has(p.id))
    .map((p) => {
      const s = item.assigned.get(p.id);
      const cost = item.cents === null ? '' : ` (${formatMoney(Math.round((item.cents * s) / total))})`;
      return `${p.name} pays ${s} of ${total}${cost}`;
    });
  return `${parts.join(', ')}.`;
}

function chipsFor(item, rerender) {
  const people = state.people;
  const everyone = people.length > 0 && people.every((p) => item.assigned.has(p.id));
  const chips = people.map((p) => {
    const n = item.assigned.get(p.id) || 0;
    if (item.uneven && n > 0) {
      return el('span', { class: 'chip has-steps' },
        el('button', {
          type: 'button', class: 'chip-name', 'aria-pressed': 'true', text: p.name, 'data-key': `chip:${item.id}:${p.id}`,
          'aria-label': `${p.name}, ${n} share${n === 1 ? '' : 's'}. Tap to remove.`,
          onclick: () => { setShares(item, p.id, 0); rerender(); },
        }),
        el('button', {
          type: 'button', class: 'step-btn', text: '−', 'aria-label': `One fewer share for ${p.name}`, disabled: n <= 1, 'data-key': `less:${item.id}:${p.id}`,
          onclick: () => { setShares(item, p.id, n - 1); rerender(); },
        }),
        el('span', { class: 'step-n', 'aria-hidden': 'true', text: String(n) }),
        el('button', {
          type: 'button', class: 'step-btn', text: '+', 'aria-label': `One more share for ${p.name}`, disabled: n >= LIMITS.maxShares, 'data-key': `more:${item.id}:${p.id}`,
          onclick: () => { setShares(item, p.id, n + 1); rerender(); },
        })
      );
    }
    return el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(n > 0), text: p.name, 'data-key': `chip:${item.id}:${p.id}`,
      onclick: () => { setShares(item, p.id, n > 0 ? 0 : 1); rerender(); },
    });
  });
  if (people.length > 1) {
    chips.push(el('button', {
      type: 'button', class: 'chip chip-all', 'aria-pressed': String(everyone && !item.uneven), text: 'Everyone', 'data-key': `all:${item.id}`,
      onclick: () => {
        const clear = everyone && !item.uneven; // everyone on evenly -> clear; otherwise everyone gets one share
        item.uneven = false;
        item.assigned = clear ? new Map() : new Map(people.map((p) => [p.id, 1]));
        syncAddons(item);
        rerender();
      },
    }));
  }

  const wrap = el('div', { class: 'assign' }, el('div', { class: 'chips', role: 'group', 'aria-label': 'Who had this' }, ...chips));
  if (item.uneven) {
    wrap.append(el('p', { class: 'share-note' },
      `${sharesNote(item)} `,
      el('button', {
        type: 'button', class: 'linkish', text: 'Even shares', 'data-key': `shares:${item.id}`,
        onclick: () => {
          item.uneven = false;
          for (const k of item.assigned.keys()) item.assigned.set(k, 1);
          syncAddons(item);
          rerender();
        },
      })
    ));
  } else if (item.assigned.size >= 2) {
    wrap.append(el('button', {
      type: 'button', class: 'linkish', text: 'Uneven shares', 'data-key': `shares:${item.id}`,
      onclick: () => { item.uneven = true; syncAddons(item); rerender(); },
    }));
  }
  return wrap;
}

function guessControls(item) {
  if (!item.guess) return [];
  return [
    el('span', { class: 'guess-note', text: item.guess === 'added' ? 'Added from the subtotal' : 'Guessed from the subtotal' }),
    el('button', {
      type: 'button', class: 'btn-confirm', text: 'Looks right',
      onclick: () => { item.guess = null; renderItems(); renderResults(); },
    }),
  ];
}

/** One line of the Options panel: label on the left, control on the right. */
const optRow = (label, ...right) => el('div', { class: 'opt-row' }, el('span', { class: 'opt-label', text: label }), ...right);

/** A full-width line in the Options panel that does something, with a › on the right. */
const optAction = (label, onclick, key) => el('button', { type: 'button', class: 'opt-action', 'data-key': key, onclick },
  el('span', { text: label }), el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));

/** "This item is:" with one choice per kind. `kinds` = [[label, isCurrent, onPick]]. */
function kindRow(item, kinds, needsPrice) {
  const row = el('div', { class: 'opt-row opt-kinds' }, el('span', { class: 'opt-label', id: `kind-${item.id}`, text: 'This item is:' }));
  const chips = el('div', { class: 'chips', role: 'group', 'aria-labelledby': `kind-${item.id}` });
  for (const [label, current, pick] of kinds) {
    chips.append(el('button', {
      type: 'button', class: 'chip', text: label, 'aria-pressed': String(current), 'data-key': `kind:${label}:${item.id}`,
      disabled: !current && needsPrice && !item.cents,
      onclick: () => { if (!current) pick(); },
    }));
  }
  row.append(chips);
  if (needsPrice && !item.cents) row.append(el('p', { class: 'opt-note', text: 'Enter a price first to change this.' }));
  return row;
}

/** The "Options" link at the end of a price line. */
function optButton(open, key, onclick, label) {
  return el('button', {
    type: 'button', class: 'linkish opt-btn', 'aria-expanded': String(open), 'data-key': key, 'aria-label': label, onclick,
  }, 'Options', open ? el('span', { 'aria-hidden': 'true', text: ' ▴' }) : null);
}

function renderAddon(addon, parent) {
  const li = el('li', { class: `addon${addon.open ? ' is-open' : ''}`, 'data-item': addon.id });
  const rerender = () => { renderItems(); renderResults(); };
  const name = addon.name || 'Add-on';

  if (!addon.open) {
    li.append(el('div', { class: 'addon-row' },
      el('span', { class: 'addon-name' }, `+ ${addon.qty > 1 ? `${addon.qty}× ` : ''}${name}`, el('small', { text: `Goes with ${parent.name || 'this dish'}` })),
      el('span', { class: 'addon-price', text: addon.cents === null ? '—' : formatMoney(addon.cents) }),
      optButton(false, `addon:${addon.id}`, () => {
        addon.open = true;
        addon.menuOpen = true;
        rerender();
        restoreFocus(`done:${addon.id}`);
      }, `Options for ${name}`)
    ));
    return li;
  }

  const { nameInput, priceInput, priceErr } = itemInputs(addon, `Add-on ${addon.name || ''}`.trim());
  li.append(
    el('div', { class: 'item-top' }, nameInput,
      el('button', { type: 'button', class: 'x-btn', 'aria-label': 'Remove add-on', text: '×', 'data-key': `x:${addon.id}`, onclick: () => removeItem(addon.id) })),
    el('div', { class: 'item-price' },
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), priceInput),
      el('button', { type: 'button', class: 'linkish opt-btn', text: 'Done', 'data-key': `done:${addon.id}`, onclick: () => closeAddon(addon) })),
    priceErr
  );
  if (addon.menuOpen) {
    li.append(el('div', { class: 'opt-menu' },
      optAction(`Detach from ${parent.name || 'this dish'}`, () => makeOwnItem(addon), `detach:${addon.id}`),
      kindRow(addon, [
        ['Add-on', true, null],
        ['Fee', false, () => makeCharge(addon, 'fee')],
        ['Tax', false, () => makeCharge(addon, 'tax')],
      ], true)));
  }
  return li;
}

function stepper(value, min, max, label, onChange, key) {
  return el('span', { class: 'qty' },
    el('button', { type: 'button', class: 'step-btn', text: '−', 'aria-label': `${label}: one less`, disabled: value <= min, 'data-key': `${key}:less`, onclick: () => onChange(value - 1) }),
    el('span', { class: 'qty-n', 'aria-live': 'polite', text: String(value) }),
    el('button', { type: 'button', class: 'step-btn', text: '+', 'aria-label': `${label}: one more`, disabled: value >= max, 'data-key': `${key}:more`, onclick: () => onChange(value + 1) }));
}

/** "2 × $17.75" next to the price. Shown only; the total is what's typed. Rounded up to the cent. */
function unitText(item) {
  const q = shownQty(item);
  if (q < 2 || item.cents === null || item.cents < 0) return null;
  return el('span', { class: 'unit', text: `${q} × ${formatMoney(Math.ceil(item.cents / q))}` });
}

function optionsMenu(item, above, isFirst, isLast) {
  const isDiscount = item.cents !== null && item.cents < 0;
  const n = item.splitN ?? Math.max(2, shownQty(item));
  const menu = el('div', { class: 'opt-menu', id: `menu-${item.id}` });
  if (!isDiscount) {
    menu.append(
      optRow('Quantity', stepper(shownQty(item), 1, 20, 'Quantity', (v) => setQty(item, v), `menuqty:${item.id}`)),
      optRow('Split into', el('span', { class: 'opt-split' },
        stepper(n, 2, 20, 'Split into', (v) => { item.splitN = v; renderItems(); }, `rows:${item.id}`),
        el('button', { type: 'button', class: 'pill', text: 'Split', 'data-key': `split:${item.id}`, 'aria-label': `Split into ${n}`, onclick: () => splitRows(item, n) }))),
      optAction('Add an add-on', () => addAddon(item), `addaddon:${item.id}`)
    );
  }
  if (!isFirst && above && !isBlank(above)) {
    menu.append(optAction(`Attach to ${above.name || 'the item above'}`, () => makeAddonOf(item, above), `attach:${item.id}`));
  }
  menu.append(optRow('Move this item', el('span', { class: 'opt-move' },
    el('button', { type: 'button', class: 'step-btn', text: '↑', 'aria-label': 'Move up', disabled: isFirst, 'data-key': `up:${item.id}`, onclick: () => moveItem(item, -1) }),
    el('button', { type: 'button', class: 'step-btn', text: '↓', 'aria-label': 'Move down', disabled: isLast, 'data-key': `down:${item.id}`, onclick: () => moveItem(item, 1) }))));
  menu.append(kindRow(item, [
    ['Item', !isDiscount, () => flipSign(item)],
    ['Discount', isDiscount, () => flipSign(item)],
    ['Fee', false, () => makeCharge(item, 'fee')],
    ['Tax', false, () => makeCharge(item, 'tax')],
  ], true));
  return menu;
}

function renderItems() { keepFocus(drawItems); }
function drawItems() {
  const list = $('items');
  const tops = topItems();
  const rows = tops.map((item, idx) => {
    const missing = item.cents === null && !isBlank(item);
    const isDiscount = item.cents !== null && item.cents < 0;
    const li = el('li', {
      class: `item${item.assigned.size ? ' is-assigned' : ''}${item.guess ? ' is-guess' : ''}${missing ? ' is-missing' : ''}`,
      'data-item': item.id, tabindex: '-1',
    });
    const rerender = () => { renderItems(); renderResults(); };
    const { nameInput, priceInput, priceErr } = itemInputs(item, `Item ${idx + 1}`);
    const label = item.name || `item ${idx + 1}`;

    li.append(
      el('div', { class: 'item-top' }, nameInput,
        el('button', { type: 'button', class: 'x-btn', 'aria-label': `Remove item ${idx + 1}`, text: '×', 'data-key': `x:${item.id}`, onclick: () => removeItem(item.id) })),
      el('div', { class: `item-price${item.guess ? ' guess' : ''}` },
        el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), priceInput),
        unitText(item),
        ...guessControls(item),
        missing && !item.guess && item.name && !item.rawPrice ? el('span', { class: 'missing-note', text: 'No price found. Enter it or remove this row.' }) : null,
        item.qtyGuess && item.qty > 1 && !isDiscount
          ? el('button', { type: 'button', class: 'linkish split-link', text: `Split into ${item.qty}?`, onclick: () => splitQuantity(item) })
          : null,
        isDiscount ? el('button', { type: 'button', class: 'btn-confirm', text: 'Spread over the whole bill', onclick: () => spreadDiscount(item) }) : null,
        isBlank(item) ? null : optButton(item.menuOpen, `opt:${item.id}`, () => { item.menuOpen = !item.menuOpen; renderItems(); }, `Options for ${label}`)
      ),
      priceErr
    );
    if (isDiscount) li.append(el('p', { class: 'discount-note', text: 'A discount. Tap who it was for, or spread it over everyone by what they ordered.' }));

    if (item.joined) {
      li.append(el('div', { class: 'item-tags' }, el('span', { class: 'tag tag-joined' },
        el('span', { class: 'tag-text', text: 'Joined from 2 lines' }),
        el('button', { type: 'button', text: 'Split apart', onclick: () => splitApart(item) }))));
    }

    const addons = addonsOf(item);
    if (addons.length) li.append(el('ul', { class: 'addons', 'aria-label': 'Add-ons' }, ...addons.map((a) => renderAddon(a, item))));

    if (item.menuOpen && !isBlank(item)) li.append(optionsMenu(item, tops[idx - 1], idx === 0, idx === tops.length - 1));

    if (state.people.length) li.append(chipsFor(item, rerender));
    return li;
  });

  list.replaceChildren(...rows);
  $('item-add').disabled = state.items.length >= LIMITS.items;
  $('items-hint').hidden = state.items.length > 0 && state.people.length > 0;
  renderCheck();
}

/** All items, including item discounts (what the subtotal on the receipt covers). */
const itemsSum = () => state.items.reduce((s, i) => s + (i.cents ?? 0), 0);
/** What the receipt's subtotal should equal: the items, plus any fee printed above the subtotal. */
const checkSum = () => state.items.reduce((s, i) => s + (i.afterSubtotal ? 0 : i.cents ?? 0), 0) + chargesInSubtotal();
/** Food as ordered, before any discount. Percent tips are worked out on this. */
const orderedSum = () => state.items.reduce((s, i) => s + (i.cents > 0 ? i.cents : 0), 0);

/** Compare the items against the receipt's subtotal to catch misreads. */
function renderCheck() {
  const out = $('items-check');
  const { subtotalCents } = state.receipt;
  let short = false;
  if (subtotalCents === null || realItems().length === 0) {
    out.hidden = true;
  } else {
    const sum = checkSum();
    const diff = subtotalCents - sum;
    const guessed = state.items.some((i) => i.guess);
    const feeIn = sumCharges(state.fees, (r) => r.inSubtotal) ?? 0;
    const taxIn = sumCharges(state.taxes, (r) => r.inSubtotal) ?? 0;
    const inParts = [feeIn ? `${formatMoney(feeIn)} in fees` : '', taxIn ? `${formatMoney(taxIn)} in tax` : ''].filter(Boolean);
    const fees = inParts.length ? ` plus ${inParts.join(' and ')}` : '';
    out.hidden = false;
    if (diff === 0) {
      out.className = 'check ok';
      out.textContent = `Items${fees} add up to ${formatMoney(sum)}, matching the receipt's subtotal${guessed ? ' (with a guessed price)' : ''}.`;
    } else {
      short = diff > 0;
      out.className = 'check warn';
      out.textContent = `Items${fees} add up to ${formatMoney(sum)}, but the receipt's subtotal is ${formatMoney(subtotalCents)} (${diff > 0 ? 'missing' : 'extra'} ${formatMoney(Math.abs(diff))}). Check the prices against the photo.`;
      const noPrice = state.items.some((i) => i.cents === null && !isBlank(i));
      if (short && !noPrice) {
        out.append(el('br'), el('button', {
          type: 'button', class: 'btn btn-quiet fix-btn', text: `Add the missing ${formatMoney(diff)}`,
          onclick: () => addMissing(diff),
        }));
      }
    }
  }
  renderTotals();
  // If money is missing, a joined name might have swallowed an item: point at those first.
  document.querySelectorAll('.tag-joined').forEach((t) => {
    t.classList.toggle('warn', short);
    t.querySelector('.tag-text').textContent = short ? 'Joined from 2 lines. Check this one' : 'Joined from 2 lines';
  });
}

function addMissing(cents) {
  if (state.items.length >= LIMITS.items) return;
  const tops = topItems();
  const last = tops[tops.length - 1];
  const row = last && isBlank(last) ? last : makeItem();
  if (row !== last) state.items.push(row);
  row.cents = cents;
  row.guess = 'added';
  renderItems();
  renderResults();
  focusItem(row.id);
}

/** After reading a receipt: if exactly one item lost its price, fill in the gap to the subtotal. */
function guessMissingPrice() {
  const { subtotalCents } = state.receipt;
  if (subtotalCents === null) return;
  const open = state.items.filter((i) => i.cents === null && !isBlank(i));
  if (open.length !== 1) return;
  const diff = subtotalCents - checkSum();
  if (diff > 0) {
    open[0].cents = diff;
    open[0].guess = 'guessed';
  }
}

/* -------------------------------------------------------------- discounts */

function readMoneyField(id) {
  const raw = $(id).value.trim();
  if (!raw) return 0;
  const cents = parseMoney(raw);
  return cents !== null && cents >= 0 ? cents : null;
}

function readDisc() {
  if ($('disc-wrap').hidden) return 0;
  const raw = $('disc').value.trim();
  if (!raw) return 0;
  const cents = parseMoney(raw);
  return cents === null ? null : Math.abs(cents); // "-10" and "10" both mean $10 off
}

function showDisc(show) {
  $('disc-wrap').hidden = !show;
  $('disc-show').hidden = show;
  renderDiscNote();
}
function renderDiscNote() {
  const names = state.discNames;
  $('disc-note').textContent = names.length
    ? `${listAnd(names)}, spread by what each person ordered.`
    : 'Coupons and other discounts on the whole bill, spread by what each person ordered.';
  $('disc-to-row').hidden = !(readDisc() > 0);
}

function spreadDiscount(item) {
  remember(`Spread ${itemLabel(item)} over the whole bill`);
  const current = readDisc() ?? 0;
  $('disc').value = centsToInput(current + Math.abs(item.cents));
  if (item.name) state.discNames.push(item.name);
  for (const a of addonsOf(item)) { a.addon = false; a.parentId = null; }
  state.items = state.items.filter((i) => i !== item);
  showDisc(true);
  renderItems();
  renderResults();
}

function discountToRow() {
  const amount = readDisc();
  if (!amount) return;
  remember('Made the discount a line item');
  const name = state.discNames.length === 1 ? state.discNames[0] : 'Discount';
  const row = makeItem({ name, cents: -amount });
  state.items.push(row);
  $('disc').value = '';
  state.discNames = [];
  showDisc(false);
  renderItems();
  renderResults();
  jumpTo(row.id);
}

/* ----------------------------------------------------------- tax and fees */

const blankTax = () => ({ id: newId(), name: 'Tax', raw: '', inSubtotal: false });
const chargeList = (kind) => (kind === 'fee' ? state.fees : state.taxes);
const chargeLabel = (row, kind) => row.name || (kind === 'fee' ? 'Fee' : 'Tax');

/** A row's amount in cents: 0 when blank, null when it isn't a dollar amount. */
function chargeCents(row) {
  const raw = row.raw.trim();
  if (!raw) return 0;
  const c = parseMoney(raw);
  return c === null ? null : Math.abs(c); // "-2.50" becomes 2.50 when the box is left
}

function sumCharges(rows, pick = () => true) {
  let total = 0;
  for (const r of rows) {
    if (!pick(r)) continue;
    const c = chargeCents(r);
    if (c === null) return null;
    total += c;
  }
  return total;
}

const readTax = () => sumCharges(state.taxes);
const readFee = () => sumCharges(state.fees);
const readFeeEven = () => sumCharges(state.fees, (r) => r.even);
/** Fees and tax printed above the subtotal, so the subtotal already includes them. */
const chargesInSubtotal = () =>
  (sumCharges(state.taxes, (r) => r.inSubtotal) ?? 0) + (sumCharges(state.fees, (r) => r.inSubtotal) ?? 0);

function refocus(selector) {
  const target = document.querySelector(selector);
  if (target) target.focus();
}

function chargeRow(row, kind) {
  const isFee = kind === 'fee';
  const label = chargeLabel(row, kind);
  const nameInput = el('input', {
    type: 'text', class: 'charge-name', maxlength: '40', autocomplete: 'off', value: row.name,
    placeholder: isFee ? 'Fee name' : 'Tax name', 'aria-label': isFee ? 'Fee name' : 'Tax name',
  });
  nameInput.addEventListener('input', () => { row.name = nameInput.value.slice(0, 40); });
  nameInput.addEventListener('blur', () => { row.name = cleanText(nameInput.value, 40); nameInput.value = row.name; renderResults(); });

  const amount = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: row.raw,
    'aria-label': `${label} amount`,
  });
  const err = el('p', { class: 'field-error', id: `err-${row.id}`, hidden: true });
  guard(amount, err, (v) => (badMoney(v) ? `The ${isFee ? 'fee' : 'tax'} amount doesn’t look like a dollar amount.` : ''));
  amount.addEventListener('input', () => {
    row.raw = amount.value.slice(0, 12);
    renderChargeSums();
    renderCheck();
    renderPayerCalcs();
    renderResults();
  });
  amount.addEventListener('blur', () => {
    const c = parseMoney(amount.value);
    if (c !== null) { row.raw = centsToInput(Math.abs(c)); amount.value = row.raw; }
  });

  const li = el('li', { class: 'charge-row', 'data-charge': row.id });
  const line = el('div', { class: 'charge-line' }, el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), amount));
  li.append(el('div', { class: 'charge-top' },
    nameInput,
    el('button', { type: 'button', class: 'x-btn', text: '×', 'aria-label': `Remove ${label}`, 'data-key': `x:${row.id}`, onclick: () => removeCharge(row, kind) })),
  line, err);

  if (isFee) {
    const mode = (even, text) => el('button', {
      type: 'button', class: 'chip', text, 'aria-pressed': String(row.even === even), 'data-key': `${even ? 'even' : 'order'}:${row.id}`,
      onclick: () => {
        row.even = even;
        renderCharges();
        renderResults();
      },
    });
    line.append(el('div', { class: 'chips', role: 'group', 'aria-label': `How to split ${label}` },
      mode(true, 'Split evenly'), mode(false, 'By order')));
  }
  line.append(optButton(Boolean(row.menuOpen), `opt:${row.id}`, () => { row.menuOpen = !row.menuOpen; renderCharges(); }, `Options for ${label}`));
  if (row.menuOpen) {
    li.append(el('div', { class: 'opt-menu' }, chargeCents(row) > 0
      ? optAction('Move to items', () => chargeToItem(row, kind), `toitem:${row.id}`)
      : el('p', { class: 'opt-note', text: 'Enter an amount first.' })));
  }
  return li;
}

function renderChargeSums() {
  const t = readTax();
  const f = readFee();
  $('tax-sum').textContent = state.taxes.length > 1 && t !== null ? `Total tax ${formatMoney(t)}` : '';
  $('fee-sum').textContent = state.fees.length > 1 && f !== null ? `Total fees ${formatMoney(f)}` : '';
}

function renderCharges() { keepFocus(drawCharges); }
function drawCharges() {
  if (!state.taxes.length) state.taxes.push(blankTax());
  $('tax-list').replaceChildren(...state.taxes.map((r) => chargeRow(r, 'tax')));
  $('fee-list').replaceChildren(...state.fees.map((r) => chargeRow(r, 'fee')));
  const hasFees = state.fees.length > 0;
  $('fee-block').hidden = !hasFees;
  $('fee-show').hidden = hasFees;
  renderChargeSums();
}

function addCharge(kind) {
  const list = chargeList(kind);
  if (list.length >= 20) return;
  const row = kind === 'fee'
    ? { id: newId(), name: '', raw: '', even: false, inSubtotal: false }
    : { ...blankTax(), name: '' };
  list.push(row);
  renderCharges();
  refocus(`[data-charge="${row.id}"] .charge-name`);
}

function removeCharge(row, kind) {
  remember(`Removed ${row.name || (kind === 'fee' ? 'a fee' : 'a tax line')}`);
  const list = chargeList(kind);
  const at = list.indexOf(row);
  const next = list[at + 1] || list[at - 1];
  if (kind === 'fee') state.fees = state.fees.filter((r) => r !== row);
  else state.taxes = state.taxes.filter((r) => r !== row);
  renderCharges();
  renderCheck();
  renderPayerCalcs();
  renderResults();
  const field = next && document.querySelector(`[data-charge="${next.id}"] .charge-name`);
  if (field) field.focus();
  else if (kind === 'fee') $('fee-show').focus();
  else refocus('#tax-list .charge-name');
}

/** Change menu: a row the reader took for a dish is really a fee or a tax line. */
function makeCharge(item, kind) {
  if (!item.cents) return;
  const name = item.name || (kind === 'fee' ? 'Fee' : 'Tax');
  remember(`Made ${name} ${kind === 'fee' ? 'a fee' : 'tax'}${detachNote(item)}`);
  const tops = topItems();
  const next = item.addon ? byId(item.parentId) : tops[tops.indexOf(item) + 1] || tops[tops.indexOf(item) - 1];
  if (!item.addon) detachAddons(item);
  const row = {
    id: newId(), name, raw: centsToInput(Math.abs(item.cents)),
    inSubtotal: !item.afterSubtotal && state.receipt.subtotalCents !== null,
  };
  if (kind === 'fee') {
    row.even = CHARGE_RE.even.test(name.toLowerCase());
    state.fees.push(row);
  } else {
    state.taxes = state.taxes.filter((r) => r.raw.trim()); // drop an untouched blank row
    state.taxes.push(row);
  }
  state.items = state.items.filter((i) => i !== item);
  renderAll();
  // Its row is gone; land on the next one instead of the top of the page.
  if (!(next && restoreFocus(`opt:${next.id}`))) $('item-add').focus();
}

/** The reverse: a tax or fee line back into a row people can claim. */
function chargeToItem(row, kind) {
  const cents = chargeCents(row);
  if (!cents || state.items.length >= LIMITS.items) return;
  remember(`Made ${chargeLabel(row, kind)} an item`);
  const item = makeItem({ name: row.name, cents, afterSubtotal: !row.inSubtotal && state.receipt.subtotalCents !== null });
  if (kind === 'fee') state.fees = state.fees.filter((r) => r !== row);
  else state.taxes = state.taxes.filter((r) => r !== row);
  state.items.push(item);
  renderAll();
  jumpTo(item.id);
}

function renderTipSplit() {
  document.querySelectorAll('#tip-split .chip').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.even === '1') === state.tipEven));
  });
}

/* ------------------------------------------------------ receipt's own totals */

function totalField(key, label) {
  const value = state.receipt[key];
  const lower = label.toLowerCase();
  if (state.editing === key) {
    const input = el('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00',
      value: value === null || value === undefined ? '' : centsToInput(value), 'aria-label': `Receipt ${lower}`,
    });
    const err = el('span', { class: 'field-error', id: `err-${key}`, hidden: true });
    guard(input, err, (v) => (badMoney(v, { negative: false }) ? `The ${lower} doesn’t look like a dollar amount.` : ''));
    const commit = () => {
      if (state.editing !== key) return;
      const raw = input.value.trim();
      const cents = raw ? parseMoney(raw) : null;
      if (raw && (cents === null || cents < 0)) return; // the message under the box says why
      state.editing = null;
      if (cents !== value) {
        remember(`Changed the receipt ${lower}`);
        state.receipt[key] = cents;
      }
      renderCheck();
      refocus(`#receipt-totals [data-edit="${key}"]`);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { state.editing = null; renderCheck(); refocus(`#receipt-totals [data-edit="${key}"]`); }
    });
    input.addEventListener('blur', commit);
    setTimeout(() => input.focus());
    const field = el('span', { class: 'total-field' }, el('span', { text: label }),
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), input));
    return [field, err];
  }
  const shown = value === null || value === undefined ? 'not found' : formatMoney(value);
  return el('span', { class: 'total-field' }, el('span', { text: `Receipt ${lower}: ${shown}` }),
    el('button', {
      type: 'button', class: 'linkish', text: 'Edit', 'data-edit': key, 'aria-label': `Edit the receipt ${lower}`,
      onclick: () => { state.editing = key; renderCheck(); },
    }));
}

function renderTotals() {
  const out = $('receipt-totals');
  if (!realItems().length) { out.hidden = true; out.replaceChildren(); return; }
  out.hidden = false;
  out.replaceChildren(...[totalField('subtotalCents', 'Subtotal'), totalField('totalCents', 'Total')].flat());
}

/* -------------------------------------------------------------------- tip */

const multiPay = () => state.people.filter((p) => state.payerIds.has(p.id)).length >= 2;
const payers = () => state.people.filter((p) => state.payerIds.has(p.id));

/** The bill before any tip: food after discounts, plus tax and fees. */
const billBeforeTip = (tax, fee, disc) => itemsSum() - disc + tax + fee;
const pctOfFood = (tip) => {
  const food = orderedSum();
  return food > 0 ? `${Math.round((tip * 100) / food)}% of the food` : '';
};

/** Single-payer tip. Returns { cents } or { error }. */
function readSingleTip(tax, fee, disc) {
  if (state.tipMode === 'amount') {
    const c = readMoneyField('tip-amt');
    return c === null ? { error: 'The tip amount doesn’t look like a dollar amount.' } : { cents: c };
  }
  if (state.tipMode === 'total') {
    const raw = $('tip-total').value.trim();
    if (!raw) return { error: 'Type the total you want to pay, tip included.' };
    const total = parseMoney(raw);
    if (total === null || total < 0) return { error: 'The total doesn’t look like a dollar amount.' };
    const before = billBeforeTip(tax, fee, disc);
    if (total < before) return { error: `The total is ${formatMoney(before - total)} less than the bill before tip (${formatMoney(before)}).` };
    return { cents: total - before };
  }
  const pct = parsePercent($('tip-pct').value);
  if (pct === null) return { error: 'The tip percent should be a number from 0 to 100.' };
  return { cents: Math.round((orderedSum() * pct) / 100) };
}

/** One payer's card: { card, tip } in cents, or { error }. */
function readCard(person) {
  const p = payEntry(person.id);
  const name = person.name;
  if (p.mode === 'total') {
    if (!p.total.trim()) return { error: `Enter ${name}'s card total.`, empty: true };
    const card = parseMoney(p.total);
    if (card === null || card < 0) return { error: `${name}'s card total doesn’t look like a dollar amount.` };
    return { card, tip: null };
  }
  if (!p.paid.trim()) return { error: `Enter what ${name} paid.`, empty: true };
  const paid = parseMoney(p.paid);
  if (paid === null || paid < 0) return { error: `What ${name} paid doesn’t look like a dollar amount.` };
  let tip = 0;
  if (p.mode === 'percent') {
    const pct = parsePercent(p.pct);
    if (pct === null) return { error: `${name}'s tip percent should be a number from 0 to 100.` };
    tip = Math.round((paid * pct) / 100);
  } else if (p.amt.trim()) {
    tip = parseMoney(p.amt);
    if (tip === null || tip < 0) return { error: `${name}'s tip doesn’t look like a dollar amount.` };
  }
  return { card: paid + tip, tip, paid };
}

/** Multi-payer tip from the cards. Returns { cents, cards: Map } or { error, id? }. */
function readCardsTip(tax, fee, disc) {
  const cards = new Map();
  let paidSum = 0;
  let anyTotal = false;
  for (const person of payers()) {
    const r = readCard(person);
    if (r.error) return { error: r.error };
    cards.set(person.id, r.card);
    if (r.tip === null) anyTotal = true;
    else paidSum += r.paid;
  }
  const sum = [...cards.values()].reduce((a, b) => a + b, 0);
  const before = billBeforeTip(tax, fee, disc);
  const gratuity = state.gratuityFromReceipt ? readMoneyField('tip-amt') ?? 0 : 0;
  const bill = before + gratuity;
  // Tips go on top of the bill, so the amounts paid before tip have to cover it.
  if (!anyTotal && paidSum < bill) {
    return { error: `The payments add up to ${formatMoney(paidSum)}, ${formatMoney(bill - paidSum)} less than the bill before tip (${formatMoney(bill)}).`, short: true, cards };
  }
  if (sum < bill) return { error: `The cards cover ${formatMoney(bill - sum)} less than the bill.`, short: true, cards };
  return { cents: sum - before, cards, gratuity };
}

function syncTipPresets() {
  const pct = parsePercent($('tip-pct').value);
  document.querySelectorAll('#tip-presets .chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(pct !== null && Number(b.dataset.pct) === pct));
  });
}

function setTipMode(mode) {
  state.tipMode = ['amount', 'total'].includes(mode) ? mode : 'percent';
  document.querySelectorAll('input[name="tip-mode"]').forEach((r) => { r.checked = r.value === state.tipMode; });
  $('tip-percent-wrap').hidden = state.tipMode !== 'percent';
  $('tip-amount-wrap').hidden = state.tipMode !== 'amount';
  $('tip-total-wrap').hidden = state.tipMode !== 'total';
  renderTipNote();
  renderResults();
}

function renderTipNote() {
  const note = $('tip-note');
  const show = state.gratuityFromReceipt && state.tipMode === 'amount' && !multiPay();
  note.hidden = !show;
  note.textContent = show ? 'This receipt already includes a gratuity. It’s filled in as the tip, so don’t add another.' : '';
}

/* ----------------------------------------------------------------- payers */

function payerTipField(person, p) {
  const rerender = () => { renderPayers(); renderResults(); };
  const segName = `pay-mode-${person.id}`;
  const seg = el('div', { class: 'seg small', role: 'radiogroup', 'aria-label': `${person.name}'s tip type` },
    ...[['percent', 'Percent'], ['amount', 'Amount'], ['total', 'Total']].map(([v, label]) => {
      const input = el('input', { type: 'radio', name: segName, value: v, checked: p.mode === v });
      input.addEventListener('change', () => { p.mode = v; rerender(); });
      return el('label', {}, input, ` ${label}`);
    }));

  const detail = el('div', { class: 'payer-detail' });
  const name = person.name;
  const messages = {
    paid: `What ${name} paid doesn’t look like a dollar amount.`,
    total: `${name}'s card total doesn’t look like a dollar amount.`,
    amt: `${name}'s tip doesn’t look like a dollar amount.`,
  };
  /** Returns [the box, its error line]. */
  const moneyInput = (key, label) => {
    const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: p[key], 'aria-label': label });
    const err = el('p', { class: 'field-error', id: `err-${key}-${person.id}`, hidden: true });
    guard(input, err, (v) => (badMoney(v, { negative: false }) ? messages[key] : ''));
    input.addEventListener('input', () => { p[key] = input.value.slice(0, 20); renderPayerCalcs(); renderResults(); });
    input.addEventListener('blur', () => {
      const c = parseMoney(input.value);
      if (c !== null && c >= 0) { input.value = centsToInput(c); p[key] = input.value; }
    });
    return [el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), input), err];
  };

  if (p.mode === 'percent') {
    const pctInput = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: p.pct, 'aria-label': `${person.name}'s tip percent` });
    const pctErr = el('p', { class: 'field-error', id: `err-pct-${person.id}`, hidden: true });
    guard(pctInput, pctErr, (v) => (badPct(v) ? `${name}'s tip percent should be a number from 0 to 100.` : ''));
    const presets = el('div', { class: 'chips' }, ...[15, 18, 20, 22].map((n) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(parsePercent(p.pct) === n), text: `${n}%`,
      onclick: () => { p.pct = String(n); rerender(); },
    })));
    pctInput.addEventListener('input', () => {
      p.pct = pctInput.value.slice(0, 8);
      presets.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(parsePercent(p.pct) === parseInt(b.textContent, 10))));
      renderPayerCalcs();
      renderResults();
    });
    detail.append(presets, el('div', { class: 'money pct' }, pctInput, el('span', { 'aria-hidden': 'true', text: '%' })), pctErr);
  } else if (p.mode === 'amount') {
    detail.append(...moneyInput('amt', `${person.name}'s tip`));
  } else {
    detail.append(...moneyInput('total', `${person.name}'s card total, tip included`));
  }
  detail.append(el('p', { class: 'payer-calc', 'data-calc': person.id, 'aria-live': 'polite' }));
  return { seg, detail, moneyInput };
}

function renderPayers() {
  const multi = multiPay();
  $('payers').hidden = !multi;
  $('tip-single').hidden = multi;
  renderTipNote();
  if (!multi) { $('payer-blocks').replaceChildren(); return; }

  $('payer-blocks').replaceChildren(...payers().map((person) => {
    const p = payEntry(person.id);
    const { seg, detail, moneyInput } = payerTipField(person, p);
    const [paidBox, paidErr] = p.mode === 'total' ? [null, null] : moneyInput('paid', `What ${person.name} paid, before tip`);
    if (paidErr) paidErr.classList.add('payer-err');
    return el('div', { class: 'payer-block' },
      el('h3', { text: person.name }),
      paidBox ? el('div', { class: 'payer-row' }, el('span', { text: 'Paid' }), paidBox) : null,
      paidErr,
      el('div', { class: 'payer-row' }, el('span', { text: 'Tip' }), seg),
      detail);
  }));
  renderPayerCalcs();
}

function renderPayerCalcs() {
  if (!multiPay()) return;
  for (const person of payers()) {
    const out = document.querySelector(`[data-calc="${person.id}"]`);
    if (!out) continue;
    const r = readCard(person);
    if (r.error) { out.textContent = ''; continue; } // the box itself shows what's wrong
    out.textContent = r.tip === null ? `Card total ${formatMoney(r.card)}` : `Tip ${formatMoney(r.tip)} · card total ${formatMoney(r.card)}`;
  }
}

/* ----------------------------------------------------------------- results */

function jumpTo(id) {
  const node = document.querySelector(`#items [data-item="${id}"]`);
  const li = node && (node.classList.contains('item') ? node : node.closest('.item'));
  if (!li) return;
  li.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  li.classList.remove('flash');
  void li.offsetWidth; // restart the highlight
  li.classList.add('flash');
  setTimeout(() => li.classList.remove('flash'), 1700);
  li.focus({ preventScroll: true });
}

/** Everything the split needs, or the first thing stopping it. */
function gather() {
  if (!state.people.length) return { block: { text: 'Add the people splitting the bill.' } };
  if (!realItems().length) return { block: { text: 'Add the items from the receipt.' } };

  const noPrice = state.items.find((i) => i.cents === null && !isBlank(i));
  if (noPrice) return { block: { text: `${cap(itemLabel(noPrice))} needs a price. Tap to jump to it.`, id: noPrice.id } };
  const guess = state.items.find((i) => i.guess);
  if (guess) return { block: { text: `Confirm the guessed price for ${itemLabel(guess)}. Tap to jump to it.`, id: guess.id } };

  const tax = readTax();
  const fee = readFee();
  const disc = readDisc();
  if (tax === null) return { block: { text: 'The tax amount doesn’t look like a dollar amount.' } };
  if (fee === null) return { block: { text: 'The fee amount doesn’t look like a dollar amount.' } };
  if (disc === null) return { block: { text: 'The discount doesn’t look like a dollar amount.' } };

  let tip;
  let cards = null;
  if (multiPay()) {
    const r = readCardsTip(tax, fee, disc);
    if (r.error) return { block: { text: r.error }, cardsShort: r.short };
    tip = r.cents;
    cards = r.cards;
  } else {
    const r = readSingleTip(tax, fee, disc);
    if (r.error) return { block: { text: r.error } };
    tip = r.cents;
  }

  const open = topItems().filter((i) => !isBlank(i) && i.assigned.size === 0);
  if (open.length) {
    const names = open.slice(0, 3).map(itemLabel).join(', ');
    const more = open.length > 3 ? ` and ${open.length - 3} more` : '';
    return { block: { text: `Still unclaimed: ${names}${more}. Tap to jump to ${open.length === 1 ? 'it' : 'the first one'}.`, id: open[0].id } };
  }
  return { tax, fee, disc, tip, cards };
}

function lineLabel(l) {
  if (!l.even) return `${l.shares} of ${l.totalShares}`;
  if (l.people > 1) return `÷${l.people}`;
  return '';
}

function lineText(l) {
  if (!l.even) return ` (${l.shares} of ${l.totalShares} shares)`;
  if (l.people > 1) return ` (split ${l.people} ways)`;
  return '';
}

/** Who pays whom, and the sentence under each person's slip. */
function settle(result, cards) {
  const ids = [...state.payerIds].filter((id) => state.people.some((p) => p.id === id));
  if (!ids.length) return { payments: [], owes: () => null };
  const paid = new Map();
  if (cards) for (const [id, c] of cards) paid.set(id, c);
  else paid.set(ids[0], result.grandTotal); // one payer covered the whole bill
  const payments = settleUp(result.rows.map((r) => ({ id: r.id, cents: (paid.get(r.id) || 0) - r.total })));

  const owes = (row) => {
    const gets = payments.filter((p) => p.to === row.id);
    const pays = payments.filter((p) => p.from === row.id);
    const getsTotal = gets.reduce((s, p) => s + p.cents, 0);
    if (!cards) {
      if (paid.has(row.id)) return `Covered the bill. Gets back ${formatMoney(getsTotal)}`;
      return pays.length ? `Pays ${personName(pays[0].to)} back ${formatMoney(pays[0].cents)}` : null;
    }
    const paysText = listAnd(pays.map((p) => `${personName(p.to)} ${formatMoney(p.cents)}`));
    if (paid.has(row.id)) {
      const start = `Paid ${formatMoney(paid.get(row.id))} by card.`;
      if (gets.length) return `${start} Gets back ${formatMoney(getsTotal)} (${gets.map((p) => `${personName(p.from)} ${formatMoney(p.cents)}`).join(', ')})`;
      if (pays.length) return `${start} Pays ${paysText}`;
      return `${start} All square.`;
    }
    return pays.length ? `Pays ${paysText}` : null;
  };
  return { payments, owes };
}

/** Plain text for pasting into a message. No alignment, no symbols that turn into boxes. */
function slipText(row, result, owes) {
  const out = [`${row.name}'s share`];
  for (const l of row.lines) out.push(`${l.addon ? '+ ' : ''}${l.name}${lineText(l)}: ${formatMoney(l.cents)}`);
  out.push(`Food & drink: ${formatMoney(row.subtotal)}`);
  if (row.discount) out.push(`Discount: ${formatMoney(row.discount)}`);
  out.push(`Tax: ${formatMoney(row.tax)}`);
  if (result.feeCents) out.push(`Fees: ${formatMoney(row.fee)}`);
  out.push(`Tip: ${formatMoney(row.tip)}`);
  out.push(`Total: ${formatMoney(row.total)}`);
  const o = owes(row);
  if (o) out.push(o);
  return out.join('\n');
}

function summaryText(result, payments) {
  const out = ["Everyone's totals"];
  for (const r of result.rows) out.push(`${r.name}: ${formatMoney(r.total)}`);
  out.push(`Bill: ${formatMoney(result.grandTotal)}`);
  if (payments.length) {
    out.push('');
    for (const p of payments) out.push(`${personName(p.from)} pays ${personName(p.to)} ${formatMoney(p.cents)}`);
  }
  return out.join('\n');
}

async function copyText(text, button, doneLabel, idleLabel) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { /* fall through */ }
  if (!ok) {
    const ta = el('textarea', { readonly: true, class: 'sr-only', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) {
    $('copy-fallback-text').value = text;
    $('copy-fallback').hidden = false;
    $('copy-fallback-text').focus();
    $('copy-fallback-text').select();
    return;
  }
  button.textContent = doneLabel;
  button.classList.add('done');
  setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = idleLabel;
    button.classList.remove('done');
  }, 2000);
}

function copyButton(label, getText, cls = 'copy-btn') {
  const b = el('button', { type: 'button', class: cls, text: label });
  b.addEventListener('click', () => copyText(getText(), b, 'Copied', label));
  return b;
}

function renderCardsLine() {
  const tipOut = $('cards-tip');
  const check = $('cards-check');
  if (!multiPay()) { tipOut.textContent = ''; check.textContent = ''; return; }
  const tax = readTax() ?? 0;
  const fee = readFee() ?? 0;
  const disc = readDisc() ?? 0;
  const r = readCardsTip(tax, fee, disc);
  if (r.error) {
    tipOut.textContent = '';
    check.className = 'check warn';
    check.textContent = r.short ? r.error : '';
    return;
  }
  const grat = r.gratuity ? `, including the receipt's ${formatMoney(r.gratuity)} gratuity` : '';
  const pct = pctOfFood(r.cents);
  tipOut.textContent = `Tip from the cards: ${formatMoney(r.cents)}${grat}${pct ? ` (about ${pct})` : ''}`;
  check.className = 'check ok';
  check.textContent = 'The cards cover the whole bill.';
}

function renderTotalCalc() {
  const out = $('tip-total-calc');
  if (state.tipMode !== 'total' || multiPay()) { out.textContent = ''; return; }
  const r = readSingleTip(readTax() ?? 0, readFee() ?? 0, readDisc() ?? 0);
  if (r.error) { out.textContent = $('tip-total').value.trim() && !badMoney($('tip-total').value, { negative: false }) ? r.error : ''; return; }
  const pct = pctOfFood(r.cents);
  out.textContent = `Tip works out to ${formatMoney(r.cents)}${pct ? ` (${pct})` : ''}`;
}

function renderResults() {
  const disc = readDisc();
  for (const check of staticChecks) check(); // values can change without typing (presets, Undo, a new receipt)
  $('disc-to-row').hidden = !(disc > 0);
  renderTotalCalc();
  renderCardsLine();

  const g = gather();
  const blockedEl = $('results-blocked');
  blockedEl.classList.toggle('done', !g.block);
  if (!g.block && !state.wasDone) announce('Everything’s assigned.');
  state.wasDone = !g.block;
  if (g.block) {
    blockedEl.replaceChildren(
      g.block.id ? el('button', { type: 'button', class: 'blocked-link', text: g.block.text, onclick: () => jumpTo(g.block.id) }) : g.block.text
    );
    $('summary').replaceChildren();
    $('slips').replaceChildren();
    $('results-foot').hidden = true;
    $('copy-all').hidden = true;
    return;
  }
  blockedEl.replaceChildren('Everything’s assigned.');

  const forSplit = realItems().map((i) => ({ ...i, name: qtyName(i) }));
  const feeEven = readFeeEven() ?? 0;
  const result = computeSplit({
    people: state.people, items: forSplit, taxCents: g.tax, tipCents: g.tip,
    feeCents: g.fee - feeEven, feeEvenCents: feeEven, tipEven: state.tipEven, discountCents: g.disc,
  });
  const { payments, owes } = settle(result, g.cards);

  // Totals-only card: one screenshot for the whole table.
  $('summary').replaceChildren(
    el('div', { class: 'summary', 'aria-label': "Everyone's totals" },
      el('h3', { text: "Everyone's totals" }),
      ...result.rows.map((r) => el('div', { class: 'sum-row' }, el('span', { text: r.name }), el('span', { text: formatMoney(r.total) }))),
      el('div', { class: 'sum-row grand' }, el('span', { text: 'Bill' }), el('span', { text: formatMoney(result.grandTotal) })),
      payments.length
        ? el('div', { class: 'sum-pay' }, ...payments.map((p) => el('p', { text: `${personName(p.from)} pays ${personName(p.to)} ${formatMoney(p.cents)}` })))
        : null),
    el('div', { class: 'sum-copy' }, copyButton('Copy totals', () => summaryText(result, payments)))
  );

  const slips = result.rows.map((row) => {
    const isPayer = state.payerIds.has(row.id);
    const lines = row.lines.length
      ? row.lines.map((l) => {
          const extra = lineLabel(l);
          return el('li', { class: 'slip-line' },
            el('span', {}, `${l.addon ? '+ ' : ''}${l.name}`, extra ? el('span', { class: 'shared', text: ` ${extra}` }) : null),
            el('span', { text: formatMoney(l.cents) }));
        })
      : [el('li', { class: 'slip-line' }, el('span', { class: 'shared', text: 'Nothing assigned' }), el('span', { text: '' }))];

    const o = owes(row);
    const sum = (label, cents) => el('div', { class: 'slip-sum' }, el('span', { text: label }), el('span', { text: formatMoney(cents) }));
    return el('div', { class: 'slip-wrap' },
      el('article', { class: 'slip', 'aria-label': `${row.name}'s share` },
        el('div', { class: 'slip-head' },
          el('span', { class: 'slip-name', text: row.name }),
          isPayer ? el('span', { class: 'slip-tag payer', text: 'Paid' }) : null),
        el('ul', { class: 'slip-lines' }, ...lines),
        el('div', { class: 'slip-sums' },
          sum('Food & drink', row.subtotal),
          row.discount ? sum('Discount', row.discount) : null,
          sum('Tax', row.tax),
          result.feeCents ? sum('Fees', row.fee) : null,
          sum('Tip', row.tip)),
        el('div', { class: 'slip-total' }, el('span', { text: 'Total' }), el('span', { text: formatMoney(row.total) })),
        o ? el('p', { class: 'slip-owes', text: o }) : null),
      el('div', { class: 'copy-row' }, copyButton(`Copy ${row.name}'s share`, () => slipText(row, result, owes)))
    );
  });
  $('slips').replaceChildren(...slips);

  const allBtn = $('copy-all');
  allBtn.hidden = result.rows.length < 2;
  allBtn.onclick = () => {
    const text = result.rows.map((r) => slipText(r, result, owes)).join('\n\n') + `\n\nEveryone together: ${formatMoney(result.grandTotal)}`;
    copyText(text, allBtn, 'Copied everyone', 'Copy everyone\'s shares');
  };

  const parts = [formatMoney(result.itemsTotal)];
  if (result.discountCents) parts.push(`− ${formatMoney(result.discountCents)} discount`);
  parts.push(`+ ${formatMoney(g.tax)} tax`);
  if (result.feeCents) parts.push(`+ ${formatMoney(result.feeCents)} fees`);
  parts.push(`+ ${formatMoney(g.tip)} tip`);
  let text = `Everyone together: ${formatMoney(result.grandTotal)} (${parts.join(' ')}).`;
  if (g.cards) {
    text += ' Matches what the cards paid.';
  } else if (state.receipt.totalCents !== null) {
    if (state.receipt.totalCents === result.grandTotal) text += ' Matches the total on the receipt.';
    else if (state.receipt.totalCents === result.grandTotal - g.tip) text += ' Matches the receipt total plus your tip.';
  }
  const foot = $('results-foot');
  foot.textContent = text;
  foot.hidden = false;
}

function renderAll() {
  renderPeople();
  renderReceiptView();
  renderCharges();
  renderTipSplit();
  renderItems();
  renderPayers();
  renderResults();
}

/* ---------------------------------------------------------------- scanning */

function showReceiptState(which) {
  $('receipt-empty').hidden = which !== 'empty';
  $('receipt-busy').hidden = which !== 'busy';
  $('receipt-done').hidden = which !== 'done';
  $('paste').hidden = which === 'busy';
}

function showError(msg) {
  const e = $('receipt-error');
  e.textContent = msg;
  e.hidden = !msg;
}

function dropPhoto() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  state.photo = null;
  state.rotation = 0;
  state.crop = null;
  state.lastRead = null;
  state.receiptShown = false;
  $('preview-img').removeAttribute('src');
  renderReceiptView();
}

/** "Show receipt" in step 3, so prices can be checked against the photo. Memory only. */
function renderReceiptView() {
  const has = Boolean(state.previewUrl);
  if (!has) state.receiptShown = false;
  $('receipt-view').hidden = !has;
  $('receipt-big').hidden = !state.receiptShown;
  const img = $('receipt-big-img');
  if (state.receiptShown) { if (img.getAttribute('src') !== state.previewUrl) img.src = state.previewUrl; } else img.removeAttribute('src');
  const toggle = $('receipt-toggle');
  toggle.textContent = state.receiptShown ? 'Hide receipt' : 'Show receipt';
  toggle.setAttribute('aria-expanded', String(state.receiptShown));
  $('scan-again').hidden = !state.lastRead;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const srcSize = (src) => ({ w: src.naturalWidth || src.width, h: src.naturalHeight || src.height });

/** Resize to a size the reader likes and convert to grayscale. */
function grayCanvas(source) {
  const { w: w0, h: h0 } = srcSize(source);
  const longSide = Math.max(w0, h0);
  let scale = 1;
  if (longSide > 2400) scale = 2400 / longSide;
  else if (longSide < 1400) scale = 1400 / longSide;
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Even out shadows and uneven light, then stretch contrast. The paper's brightness
 * is estimated block by block (brightest pixels in each 32px block), smoothed, and
 * each pixel is divided by it, so a shadow over half the receipt stops looking like ink.
 */
function evenedCanvas(gray) {
  const w = gray.width;
  const h = gray.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(gray, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  const B = 32;
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const hist = new Uint32Array(64);
      let n = 0;
      for (let y = gy * B; y < Math.min(h, gy * B + B); y += 2) {
        for (let x = gx * B; x < Math.min(w, gx * B + B); x += 2) {
          hist[d[(y * w + x) * 4] >> 2]++;
          n++;
        }
      }
      let want = n * 0.1;
      let v = 63;
      while (v > 0 && want > hist[v]) { want -= hist[v]; v--; }
      grid[gy * gw + gx] = (v << 2) + 2;
    }
  }
  const smooth = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let c = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = gy + dy;
          const xx = gx + dx;
          if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          s += grid[yy * gw + xx];
          c++;
        }
      }
      smooth[gy * gw + gx] = Math.max(40, s / c);
    }
  }

  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.001, Math.max(0, y / B - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / B - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const x1 = Math.min(gw - 1, x0 + 1);
      const y1 = Math.min(gh - 1, y0 + 1);
      const bg = (smooth[y0 * gw + x0] * (1 - tx) + smooth[y0 * gw + x1] * tx) * (1 - ty)
        + (smooth[y1 * gw + x0] * (1 - tx) + smooth[y1 * gw + x1] * tx) * ty;
      const p = (y * w + x) * 4;
      const v = Math.min(255, (d[p] * 245) / bg);
      d[p] = v;
      hist[v | 0]++;
    }
  }
  let lo = 0;
  let acc = 0;
  const total = w * h;
  while (lo < 200 && acc + hist[lo] < total * 0.01) { acc += hist[lo]; lo++; }
  const span = Math.max(30, 245 - lo);
  for (let p = 0; p < d.length; p += 4) {
    const v = Math.max(0, Math.min(255, ((d[p] - lo) * 255) / span));
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Darken mid-grays so faint, light-gray print stands out. */
function darkCanvas(src) {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, 3));
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
  ctx.putImageData(img, 0, 0);
  return out;
}

const STATUS = {
  'loading tesseract core': 'Getting the reader ready…',
  'initializing tesseract': 'Getting the reader ready…',
  'loading language traineddata': 'Loading the English reader…',
  'initializing api': 'Getting the reader ready…',
};

/**
 * Faint, light-gray print the first reading may have skipped (quantity lines under
 * dishes, mostly). Looks at the middle of the cleaned-up photo: lots of gray next to
 * little real ink means faint print.
 */
function faintInk(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let dark = 0;
  let gray = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    const px = (i / 4) % w;
    const py = Math.floor(i / 4 / w);
    if (px < w * 0.12 || px > w * 0.88 || py < h * 0.08 || py > h * 0.92) continue;
    const v = d[i];
    n++;
    if (v < 90) dark++;
    else if (v < 225) gray++;
  }
  return n > 0 && dark / n > 0.005 && gray / Math.max(dark, 1) >= 1.8;
}

/**
 * Keep the first reading's items, and take only quantities from the darker one,
 * and only when both readings found the same rows at the same prices.
 */
function borrowQuantities(first, darker) {
  if (scoreParse(darker) < 10000 || first.items.length !== darker.items.length) return first;
  const same = first.items.every((it, k) => it.cents === darker.items[k].cents && Boolean(it.addon) === Boolean(darker.items[k].addon));
  if (!same) return first;
  const items = first.items.map((it, k) => {
    const d = darker.items[k];
    return (it.qty || 1) === 1 && (d.qty || 1) > 1 && !d.qtyGuess ? { ...it, qty: d.qty } : it;
  });
  return { ...first, items };
}

/** Read one image both ways (reader's lines with size data, and rows rebuilt from words). */
async function readImage(worker, canvas) {
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return bestParse(linesFromBlocks(data.blocks), textFromWords(wordsFromBlocks(data.blocks)), data.text || '');
}

/** Our own confirmation box. Resolves true for the action button, false for Cancel, Esc or a tap outside. */
function confirmDialog({ title, body, action }) {
  const dlg = $('confirm');
  if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title} ${body}`));
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-ok').textContent = action;
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    $('confirm-cancel').focus();
  });
}

/** A new reading replaces the list, so ask first if anyone's already been assigned. */
async function confirmReplace() {
  if (!state.items.some((i) => i.assigned.size > 0)) return true;
  return confirmDialog({
    title: 'Replace the items?',
    body: 'Reading this receipt replaces the item list and who had what.',
    action: 'Replace',
  });
}

async function scan(file) {
  showError('');
  if (!file) return;
  if (!/^image\//.test(file.type) && file.type !== '') {
    showError('That file isn’t an image. Pick a photo of the receipt.');
    return;
  }
  if (file.size > LIMITS.fileBytes) {
    showError('That photo is over 25 MB. Take a new one or use a smaller copy.');
    return;
  }
  if (!(await confirmReplace())) return;
  const snap = snapshot();
  dropPhoto();
  state.photo = file;
  state.previewUrl = URL.createObjectURL(file);
  $('preview-img').src = state.previewUrl;
  const had = realItems().length > 0; // a first reading has nothing to go back to
  if ((await read(async () => decodeImage(file))) && had) remember('Read a new receipt', { snap });
}

/**
 * Run the reader on whatever `getSource` produces (the whole photo, or a crop of it).
 * `darker` (Scan again) reads only with darker grays. Returns true when it worked.
 */
async function read(getSource, { darker = false } = {}) {
  if (typeof window.Tesseract === 'undefined') {
    showError('The receipt reader didn’t load. Refresh the page and try again.');
    return false;
  }
  if (!darker) state.lastRead = getSource;
  const token = ++state.scanToken;
  showReceiptState('busy');
  $('busy-text').textContent = 'Getting the reader ready…';
  $('busy-bar').value = 0;

  let worker = null;
  let gray = null;
  let evened = null;
  let pass = 1;
  try {
    const source = await getSource();
    gray = grayCanvas(source);
    if (typeof source.close === 'function') source.close();
    evened = evenedCanvas(gray);

    const base = document.baseURI;
    worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: new URL('vendor/tesseract/worker.min.js', base).href,
      corePath: new URL('vendor/tesseract-core/', base).href,
      langPath: new URL('vendor/lang', base).href,
      workerBlobURL: false,
      cacheMethod: 'none', // don't stash the language file in IndexedDB
      gzip: true,
      logger: (m) => {
        if (token !== state.scanToken) return;
        if (STATUS[m.status]) $('busy-text').textContent = STATUS[m.status];
        if (m.status === 'recognizing text') {
          $('busy-text').textContent = darker ? 'Scanning again with darker grays…' : pass === 1 ? 'Reading the receipt…' : 'Taking another look…';
          $('busy-bar').value = Math.round(((pass - 1) * 100) / 3 + ((m.progress || 0) * 100) / 3);
        }
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

    // Cleaned-up photo first. If the items don't add up to the subtotal, try darker grays
    // (faint print), then the plain photo, and keep whichever reading lands closest.
    let parsed;
    if (darker) {
      const canvas = darkCanvas(evened);
      parsed = await readImage(worker, canvas);
      canvas.width = 0; canvas.height = 0;
      if (token !== state.scanToken) return false;
    } else {
      parsed = await readImage(worker, evened);
      if (token !== state.scanToken) return false;
      for (const next of [() => darkCanvas(evened), () => gray]) {
        if (scoreParse(parsed) >= 10000) break;
        pass++;
        const canvas = next();
        const other = await readImage(worker, canvas);
        if (canvas !== gray) { canvas.width = 0; canvas.height = 0; }
        if (token !== state.scanToken) return false;
        if (scoreParse(other) > scoreParse(parsed)) parsed = other;
      }
      // It added up, but faint print (like "2 @ $8.25" under a dish) may have been skipped.
      if (pass === 1 && scoreParse(parsed) >= 10000 && faintInk(evened)) {
        pass++;
        const canvas = darkCanvas(evened);
        const other = await readImage(worker, canvas);
        canvas.width = 0; canvas.height = 0;
        if (token !== state.scanToken) return false;
        parsed = borrowQuantities(parsed, other);
      }
    }
    applyParsed(parsed);
    showReceiptState('done');
    renderReceiptView();
    return true;
  } catch {
    if (token !== state.scanToken) return false;
    if (state.photo) {
      showReceiptState('done');
      showError('Couldn’t read that. Try cropping again, or use a different photo.');
    } else {
      dropPhoto();
      showReceiptState('empty');
      showError('Couldn’t read that photo. Try again with the receipt flat and well lit, or type the items in.');
    }
    return false;
  } finally {
    if (worker) worker.terminate().catch(() => {});
    for (const c of [gray, evened]) if (c) { c.width = 0; c.height = 0; }
  }
}

/** Read the same photo again with darker grays, with one tap to go back. */
async function scanAgain() {
  if (!state.lastRead || !(await confirmReplace())) return;
  const snap = snapshot();
  const worked = await read(state.lastRead, { darker: true });
  if (worked) remember('Scanned again with darker grays', { snap, sticky: true });
}

function resetTip() {
  $('tip-amt').value = '';
  $('tip-total').value = '';
  state.gratuityFromReceipt = false;
  setTipMode('percent');
}

function applyParsed(parsed, { append = false, noteEl = $('receipt-note') } = {}) {
  state.items = append ? state.items.filter((i) => !isBlank(i)) : [];
  let room = LIMITS.items - state.items.length;
  const created = [];
  parsed.items.forEach((p, idx) => {
    if (room <= 0) return;
    const parent = p.addon ? created[p.parent] : null;
    const item = makeItem({
      name: p.name, cents: p.cents, qty: p.qty || 1, qtyGuess: Boolean(p.qtyGuess), joined: p.joined,
      addon: Boolean(parent), parentId: parent ? parent.id : null, afterSubtotal: Boolean(p.afterSubtotal),
    });
    created[idx] = item;
    state.items.push(item);
    room--;
  });

  // Tax and fee lines as the receipt printed them, one row each.
  const hasSubtotal = parsed.subtotalCents !== null && parsed.subtotalCents !== undefined;
  let taxes = (parsed.taxes || []).map((t) => ({ id: newId(), name: t.name, raw: centsToInput(t.cents), inSubtotal: false }));
  if (!taxes.length && parsed.taxCents !== null && parsed.taxCents !== undefined) taxes = [{ ...blankTax(), raw: centsToInput(parsed.taxCents) }];
  let fees = (parsed.fees || []).map((f) => ({
    id: newId(), name: f.name, raw: centsToInput(f.cents), even: Boolean(f.even), inSubtotal: Boolean(f.inSubtotal) && hasSubtotal,
  }));
  if (!fees.length && parsed.feeCents) fees = [{ id: newId(), name: 'Fees', raw: centsToInput(parsed.feeCents), even: false, inSubtotal: false }];

  if (append) {
    if (hasSubtotal) state.receipt.subtotalCents = parsed.subtotalCents;
    if (parsed.totalCents !== null) state.receipt.totalCents = parsed.totalCents;
    if (taxes.length && !readTax()) state.taxes = taxes;
    if (fees.length && !state.fees.length) state.fees = fees;
  } else {
    // A new receipt starts clean: nothing carried over from the last one.
    state.receipt = { subtotalCents: parsed.subtotalCents, totalCents: parsed.totalCents };
    state.taxes = taxes;
    state.fees = fees;
    $('disc').value = '';
    state.discNames = [];
    showDisc(false);
    resetTip();
  }
  state.tipEven = state.fees.some((f) => f.even); // a delivery order: the driver's tip splits evenly
  if (parsed.tipCents !== null && parsed.tipCents > 0 && (!append || !$('tip-amt').value.trim())) {
    $('tip-amt').value = centsToInput(parsed.tipCents);
    state.gratuityFromReceipt = Boolean(parsed.gratuity);
    setTipMode('amount');
  }
  guessMissingPrice();

  const dishes = created.filter((i) => i && !i.addon && !(i.cents < 0)).length;
  const extras = created.filter((i) => i && i.addon).length;
  const discounts = created.filter((i) => i && !i.addon && i.cents < 0).length;
  if (parsed.cardSlip) {
    noteEl.textContent = 'This looks like the card slip, not the itemized check. Take a photo of the check that lists the dishes.';
  } else if (dishes + extras + discounts === 0) {
    noteEl.textContent = append
      ? 'No prices found in that text. Each item needs its price on the same line, like “Iced Tea 3.25”.'
      : 'No prices found in that photo. Try a sharper shot or crop it, or add the items by hand below.';
  } else {
    const found = [`${dishes} item${dishes === 1 ? '' : 's'}`];
    if (extras) found.push(`${extras} add-on${extras === 1 ? '' : 's'}`);
    if (discounts) found.push(`${discounts} discount${discounts === 1 ? '' : 's'}`);
    // "Found 3 items. Subtotal $78.25 · Tax $6.65 · Fees $4.29 · Total $84.90."
    const amount = (c) => (c === null || c === undefined ? 'not found' : formatMoney(c));
    const figures = [`Subtotal ${amount(parsed.subtotalCents)}`, `Tax ${amount(parsed.taxCents)}`];
    if (parsed.feeCents) figures.push(`Fees ${formatMoney(parsed.feeCents)}`);
    if (parsed.tipCents !== null && parsed.tipCents > 0) figures.push(`${parsed.gratuity ? 'Gratuity' : 'Tip'} ${formatMoney(parsed.tipCents)}`);
    figures.push(`Total ${amount(parsed.totalCents)}`);
    noteEl.textContent = `Found ${listAnd(found)}. ${figures.join(' · ')}.`;
  }

  renderTipNote();
  renderCharges();
  renderTipSplit();
  renderItems();
  renderPayers();
  renderResults();
}

/* -------------------------------------------------------- crop and rotate */

const crop = { img: null, drag: null };

function rotatedSize() {
  const { w, h } = srcSize(crop.img);
  return state.rotation % 180 ? { rw: h, rh: w } : { rw: w, rh: h };
}

/** Draw the photo turned by `rotation` degrees, in rotated-image coordinates. */
function drawRotated(ctx, img, rw, rh) {
  const { w, h } = srcSize(img);
  ctx.save();
  if (state.rotation === 90) { ctx.translate(rw, 0); ctx.rotate(Math.PI / 2); }
  else if (state.rotation === 180) { ctx.translate(rw, rh); ctx.rotate(Math.PI); }
  else if (state.rotation === 270) { ctx.translate(0, rh); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}

function drawCrop() {
  const canvas = $('crop-canvas');
  const { rw, rh } = rotatedSize();
  const maxW = $('crop').querySelector('.crop-inner').clientWidth || 360;
  const maxH = Math.max(240, window.innerHeight * 0.62);
  const scale = Math.min(maxW / rw, maxH / rh, 1);
  const cssW = Math.max(1, Math.round(rw * scale));
  const cssH = Math.max(1, Math.round(rh * scale));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform((cssW * dpr) / rw, 0, 0, (cssH * dpr) / rh, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  drawRotated(ctx, crop.img, rw, rh);
  placeBox();
}

function placeBox() {
  const r = state.crop;
  const box = $('crop-box');
  box.style.left = `${r.x * 100}%`;
  box.style.top = `${r.y * 100}%`;
  box.style.width = `${r.w * 100}%`;
  box.style.height = `${r.h * 100}%`;
}

const fullCrop = () => ({ x: 0.04, y: 0.03, w: 0.92, h: 0.94 });

async function openCrop() {
  if (!state.photo) return;
  try {
    crop.img = await decodeImage(state.photo);
  } catch {
    showError('Couldn’t open that photo for cropping.');
    return;
  }
  if (!state.crop) state.crop = fullCrop();
  $('crop').hidden = false;
  document.body.classList.add('no-scroll');
  drawCrop();
  $('crop-read').focus();
}

function closeCrop() {
  $('crop').hidden = true;
  document.body.classList.remove('no-scroll');
  if (crop.img && typeof crop.img.close === 'function') crop.img.close();
  crop.img = null;
  const canvas = $('crop-canvas');
  canvas.width = 0;
  canvas.height = 0;
  $('crop-open').focus();
}

/** Move one edge set of the crop box, keeping it inside the photo and at least 8% in size. */
function resizeCrop(handle, dx, dy) {
  const MIN = 0.08;
  const r = { ...state.crop };
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;
  if (handle === 'move') {
    const nx = Math.min(1 - r.w, Math.max(0, r.x + dx));
    const ny = Math.min(1 - r.h, Math.max(0, r.y + dy));
    state.crop = { ...r, x: nx, y: ny };
    placeBox();
    return;
  }
  if (handle.includes('l')) x1 = Math.min(x2 - MIN, Math.max(0, x1 + dx));
  if (handle.includes('r')) x2 = Math.max(x1 + MIN, Math.min(1, x2 + dx));
  if (handle.includes('t')) y1 = Math.min(y2 - MIN, Math.max(0, y1 + dy));
  if (handle.includes('b')) y2 = Math.max(y1 + MIN, Math.min(1, y2 + dy));
  state.crop = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  placeBox();
}

function onCropPointerDown(e) {
  const handle = e.target.closest('.handle')?.dataset.h || (e.target.closest('#crop-box') ? 'move' : null);
  if (!handle) return;
  e.preventDefault();
  const rect = $('crop-canvas').getBoundingClientRect();
  crop.drag = { handle, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, id: e.pointerId };
  e.target.setPointerCapture?.(e.pointerId);
}

function onCropPointerMove(e) {
  const d = crop.drag;
  if (!d || e.pointerId !== d.id) return;
  const dx = (e.clientX - d.x) / d.w;
  const dy = (e.clientY - d.y) / d.h;
  d.x = e.clientX;
  d.y = e.clientY;
  resizeCrop(d.handle, dx, dy);
}

function onCropPointerUp(e) {
  if (crop.drag && e.pointerId === crop.drag.id) crop.drag = null;
}

function onHandleKey(e) {
  const handle = e.target.dataset.h;
  const step = e.shiftKey ? 0.1 : 0.02;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (!handle || !moves[e.key]) return;
  e.preventDefault();
  resizeCrop(handle, ...moves[e.key]);
}

function rotateCrop() {
  state.rotation = (state.rotation + 90) % 360;
  state.crop = fullCrop();
  drawCrop();
}

async function readCrop() {
  if (!crop.img) return;
  if (!(await confirmReplace())) return;
  if (!crop.img) return;
  const snap = snapshot();
  const had = realItems().length > 0;
  const img = crop.img;
  crop.img = null; // the reader owns it now
  const r = state.crop;
  $('crop').hidden = true;
  document.body.classList.remove('no-scroll');
  const canvas = $('crop-canvas');
  canvas.width = 0;
  canvas.height = 0;
  const worked = await read(async () => {
    // Cut the crop out of the turned photo at full resolution (capped at 3000px).
    const { w, h } = srcSize(img);
    const rw = state.rotation % 180 ? h : w;
    const rh = state.rotation % 180 ? w : h;
    const cw = Math.max(1, Math.round(r.w * rw));
    const ch = Math.max(1, Math.round(r.h * rh));
    const s = Math.min(1, 3000 / Math.max(cw, ch));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cw * s));
    out.height = Math.max(1, Math.round(ch * s));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(s, s);
    ctx.translate(-r.x * rw, -r.y * rh);
    drawRotated(ctx, img, rw, rh);
    if (typeof img.close === 'function') img.close();
    return out;
  });
  if (worked && had) remember('Read the cropped receipt', { snap });
}

/* ------------------------------------------------------------------- paste */

function setPasteOpen(open) {
  $('paste-panel').hidden = !open;
  $('paste-toggle').hidden = open;
  $('paste-toggle').setAttribute('aria-expanded', String(open));
  if (!open) $('paste-text').value = '';
  else $('paste-text').focus();
}

function readPasted() {
  const raw = $('paste-text').value.slice(0, LIMITS.pasteChars);
  if (!raw.trim()) { $('paste-text').focus(); return; }
  const parsed = bestParse(raw, pairColumns(raw));
  const snap = snapshot();
  const had = realItems().length > 0;
  applyParsed(parsed, { append: true, noteEl: $('paste-note') });
  if (parsed.items.length && had) remember(`Added ${parsed.items.length} line${parsed.items.length === 1 ? '' : 's'} from the text`, { snap });
  if (parsed.items.length) {
    setPasteOpen(false); // clears the box
  }
}

/* ------------------------------------------------------------------- reset */

async function resetAll() {
  const hasData = state.people.length || state.items.length || state.previewUrl;
  if (hasData && !(await confirmDialog({ title: 'Start over?', body: 'This clears everything on the page.', action: 'Start over' }))) return;
  const snap = snapshot();
  state.scanToken++;
  dropPhoto();
  state.people = [];
  state.payerIds = new Set();
  state.pay = new Map();
  state.items = [];
  state.receipt = { subtotalCents: null, totalCents: null };
  state.discNames = [];
  state.taxes = [];
  state.fees = [];
  state.tipEven = false;
  state.editing = null;
  for (const id of ['disc', 'tip-amt', 'tip-total', 'person-name', 'copy-fallback-text']) $(id).value = '';
  $('tip-pct').value = '20';
  $('receipt-note').textContent = '';
  $('paste-note').textContent = '';
  $('copy-fallback').hidden = true;
  showDisc(false);
  setPasteOpen(false);
  syncTipPresets();
  resetTip();
  showError('');
  showReceiptState('empty');
  renderAll();
  // Everything typed comes back with Undo. The photo doesn't: it's let go of right away.
  if (hasData) remember('Started over', { snap });
  window.scrollTo({ top: 0 });
}

/* -------------------------------------------------------------------- wire */

function onPick(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ''; // let go of the input's reference right away
  scan(file);
}

$('photo').addEventListener('change', onPick);
$('photo-again').addEventListener('change', onPick);
$('photo-remove').addEventListener('click', () => {
  state.scanToken++;
  dropPhoto();
  renderAll();
  $('receipt-note').textContent = '';
  showError('');
  showReceiptState('empty');
});
$('crop-open').addEventListener('click', openCrop);
$('crop-cancel').addEventListener('click', closeCrop);
$('crop-rotate').addEventListener('click', rotateCrop);
$('crop-read').addEventListener('click', readCrop);
$('crop-stage').addEventListener('pointerdown', onCropPointerDown);
$('crop-stage').addEventListener('pointermove', onCropPointerMove);
$('crop-stage').addEventListener('pointerup', onCropPointerUp);
$('crop-stage').addEventListener('pointercancel', onCropPointerUp);
document.querySelectorAll('#crop-box .handle').forEach((h) => h.addEventListener('keydown', onHandleKey));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('crop').hidden && !$('confirm').open) closeCrop(); });
window.addEventListener('resize', () => { if (!$('crop').hidden && crop.img) drawCrop(); });

$('item-add').addEventListener('click', () => addItem());
$('person-add').addEventListener('click', addPerson);
$('person-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPerson(); }
});
const staticChecks = [
  guard($('disc'), $('disc-err'), (v) => (badMoney(v) ? 'The discount doesn’t look like a dollar amount.' : '')),
  guard($('tip-pct'), $('tip-pct-err'), (v) => (badPct(v) ? 'The tip percent should be a number from 0 to 100.' : '')),
  guard($('tip-amt'), $('tip-amt-err'), (v) => (badMoney(v, { negative: false }) ? 'The tip amount doesn’t look like a dollar amount.' : '')),
  guard($('tip-total'), $('tip-total-err'), (v) => (badMoney(v, { negative: false }) ? 'The total doesn’t look like a dollar amount.' : '')),
];
for (const id of ['disc', 'tip-total']) {
  $(id).addEventListener('input', () => { renderPayerCalcs(); renderResults(); });
  $(id).addEventListener('blur', () => {
    const c = parseMoney($(id).value);
    if (c !== null) $(id).value = centsToInput(Math.abs(c));
  });
}
$('fee-show').addEventListener('click', () => addCharge('fee'));
$('fee-add').addEventListener('click', () => addCharge('fee'));
$('tax-add').addEventListener('click', () => addCharge('tax'));
document.querySelectorAll('#tip-split .chip').forEach((b) => {
  b.addEventListener('click', () => { state.tipEven = b.dataset.even === '1'; renderTipSplit(); renderResults(); });
});
$('scan-again').addEventListener('click', scanAgain);
$('receipt-toggle').addEventListener('click', () => { state.receiptShown = !state.receiptShown; renderReceiptView(); });
$('disc-show').addEventListener('click', () => { showDisc(true); $('disc').focus(); });
$('disc-to-row').addEventListener('click', discountToRow);
$('tip-amt').addEventListener('input', () => {
  // A tip typed by hand is no longer the receipt's gratuity.
  if (state.gratuityFromReceipt) { state.gratuityFromReceipt = false; renderTipNote(); }
  renderResults();
});
$('tip-pct').addEventListener('input', () => { syncTipPresets(); renderResults(); });
document.querySelectorAll('#tip-presets .chip').forEach((b) => {
  b.addEventListener('click', () => {
    $('tip-pct').value = b.dataset.pct;
    syncTipPresets();
    renderResults();
  });
});
document.querySelectorAll('input[name="tip-mode"]').forEach((r) => {
  r.addEventListener('change', () => setTipMode(r.value));
});
$('undo-btn').addEventListener('click', () => undo());
$('undo-step').addEventListener('click', () => undo({ fromButton: true }));
$('confirm-ok').addEventListener('click', () => $('confirm').close('ok'));
$('confirm-cancel').addEventListener('click', () => $('confirm').close('cancel'));
// A tap on the dimmed page around the box counts as Cancel.
$('confirm').addEventListener('click', (e) => { if (e.target === $('confirm')) $('confirm').close('cancel'); });
$('undo-close').addEventListener('click', hideUndo);
const undoBar = $('undo-bar');
undoBar.addEventListener('pointerenter', () => { state.undoHover = true; armUndo(); });
undoBar.addEventListener('pointerleave', () => { state.undoHover = false; armUndo(); });
undoBar.addEventListener('focusin', armUndo);
undoBar.addEventListener('focusout', () => setTimeout(armUndo));
if (window.visualViewport) window.visualViewport.addEventListener('resize', armUndo);
// Keyboard users keep the toast until they act on it; a tap anywhere switches back.
document.addEventListener('keydown', (e) => {
  if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { state.keyboardUser = true; armUndo(); }
});
document.addEventListener('pointerdown', (e) => {
  state.keyboardUser = false;
  if (!undoBar.contains(e.target)) { state.undoHover = false; armUndo(); }
});
// After Scan again the toast stays until the next tap somewhere else.
document.addEventListener('click', (e) => {
  if (state.undoSticky && !undoBar.hidden && !undoBar.contains(e.target) && e.target.id !== 'scan-again') hideUndo();
});
$('reset').addEventListener('click', resetAll);
$('paste-toggle').addEventListener('click', () => { $('paste-note').textContent = ''; setPasteOpen(true); });
$('paste-cancel').addEventListener('click', () => setPasteOpen(false));
$('paste-read').addEventListener('click', readPasted);
$('copy-fallback-close').addEventListener('click', () => {
  $('copy-fallback').hidden = true;
  $('copy-fallback-text').value = '';
});

renderAll();
