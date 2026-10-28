import { parseMoney, parsePercent, formatMoney, centsToInput, computeSplit, splitEven, settleUp } from './split.js';
import { bestParse, pairColumns, textFromWords, wordsFromBlocks, linesFromBlocks, scoreParse } from './parse.js';

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
  undo: null,
  undoTimer: 0,
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

const cleanText = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/* ------------------------------------------------------------------- model */

/**
 * item = {
 *   id, name, cents (int | null), rawPrice,
 *   assigned: Map<personId, shares>, uneven,
 *   addon, parentId, open (add-on editor shown),
 *   joined: { base, extra } | null, qty, qtyGuess,
 *   guess: null | 'guessed' | 'added'   (price came from the subtotal, not confirmed yet)
 *   afterSubtotal (a discount printed below the subtotal; not part of the subtotal check)
 * }
 * Add-ons always follow their dish's people. They never have people of their own.
 */
function makeItem({ name = '', cents = null, qty = 1, qtyGuess = false, addon = false, parentId = null, joined = null, afterSubtotal = false } = {}) {
  return {
    id: newId(), name: cleanText(name, LIMITS.itemLen), cents, rawPrice: '',
    assigned: new Map(), uneven: false,
    addon, parentId, open: false,
    joined, qty, qtyGuess, guess: null, afterSubtotal,
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
  };
}

function remember(label) {
  state.undo = snapshot();
  $('undo-text').textContent = `Removed ${label}`;
  $('undo-bar').hidden = false;
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(hideUndo, 5000);
}

function hideUndo() {
  clearTimeout(state.undoTimer);
  state.undo = null;
  $('undo-bar').hidden = true;
  $('undo-text').textContent = '';
}

function undo() {
  const snap = state.undo;
  if (!snap) return;
  state.people = snap.people;
  state.payerIds = snap.payerIds;
  state.pay = snap.pay;
  state.items = snap.items;
  hideUndo();
  renderAll();
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
  remember(personName(id));
  state.people = state.people.filter((p) => p.id !== id);
  state.payerIds.delete(id);
  state.pay.delete(id);
  topItems().forEach((item) => setShares(item, id, 0));
  renderAll();
}

function togglePayer(id) {
  if (state.payerIds.has(id)) state.payerIds.delete(id);
  else { state.payerIds.add(id); payEntry(id); }
  renderPeople();
  renderPayers();
  renderResults();
}

function renderPeople() {
  $('people').replaceChildren(
    ...state.people.map((p) => {
      const paid = state.payerIds.has(p.id);
      return el('li', { class: 'person' },
        el('span', { class: 'person-name', text: p.name }),
        el('button', {
          type: 'button', class: 'payer-btn', 'aria-pressed': String(paid), 'aria-label': `${p.name} paid`,
          text: paid ? 'Paid' : 'Mark as payer', onclick: () => togglePayer(p.id),
        }),
        el('button', { type: 'button', class: 'x-btn', 'aria-label': `Remove ${p.name}`, text: '×', onclick: () => removePerson(p.id) })
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
  if (!silent) remember(item.name || (item.addon ? 'an add-on' : 'an item'));
  // Add-ons of a removed dish stay on the bill as their own rows.
  for (const a of addonsOf(item)) { a.addon = false; a.parentId = null; a.open = false; a.assigned = new Map(); a.uneven = false; }
  state.items = state.items.filter((i) => i.id !== id);
  renderItems();
  renderResults();
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
  // Its own people are dropped: an add-on always follows its dish.
  const own = addonsOf(item);
  item.addon = true;
  item.parentId = parent.id;
  item.joined = null;
  item.qty = 1;
  item.qtyGuess = false;
  item.open = false;
  for (const a of own) a.parentId = parent.id; // add-ons are one level deep
  moveAfter([item, ...own], parent);
  syncAddons(parent);
  renderItems();
  renderResults();
}

function makeOwnItem(addon) {
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

function splitQuantity(item) {
  const n = item.qty;
  if (n < 2 || state.items.length + n - 1 > LIMITS.items) return;
  if (item.qtyGuess) item.name = item.name.replace(/^\d{1,2}\s*/, ''); // "7 Layer Dip" x7 -> "Layer Dip"
  const parts = item.cents === null ? new Array(n).fill(null) : splitEven(item.cents, n);
  const copies = parts.map((c, k) => (k === 0 ? item : makeItem({ name: item.name, cents: c })));
  item.cents = parts[0];
  item.qty = 1;
  item.qtyGuess = false;
  item.assigned = new Map();
  item.uneven = false;
  syncAddons(item);
  state.items.splice(blockEnd(item), 0, ...copies.slice(1));
  renderItems();
  renderResults();
}

/** Name and price inputs, shared by dishes and opened add-ons. */
function itemInputs(item, label) {
  const nameInput = el('input', {
    type: 'text', value: item.name, maxlength: LIMITS.itemLen, autocomplete: 'off',
    placeholder: item.guess === 'added' ? 'What was it?' : item.addon ? 'Add-on' : 'Item', enterkeyhint: 'next', 'aria-label': `${label} name`,
  });
  const priceInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', enterkeyhint: item.addon ? 'done' : 'next',
    value: item.cents === null ? '' : centsToInput(item.cents), 'aria-label': `${label} price`, 'aria-invalid': 'false',
  });

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
    priceInput.setAttribute('aria-invalid', String(cents === null && priceInput.value.trim() !== ''));
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

  return { nameInput, priceInput };
}

function closeAddon(addon) {
  if (!addon.name && addon.cents === null && !addon.rawPrice) {
    state.items = state.items.filter((i) => i !== addon); // an empty add-on is just discarded
  } else {
    addon.open = false;
  }
  renderItems();
  renderResults();
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
          type: 'button', class: 'chip-name', 'aria-pressed': 'true', text: p.name,
          'aria-label': `${p.name}, ${n} share${n === 1 ? '' : 's'}. Tap to remove.`,
          onclick: () => { setShares(item, p.id, 0); rerender(); },
        }),
        el('button', {
          type: 'button', class: 'step-btn', text: '−', 'aria-label': `One fewer share for ${p.name}`, disabled: n <= 1,
          onclick: () => { setShares(item, p.id, n - 1); rerender(); },
        }),
        el('span', { class: 'step-n', 'aria-hidden': 'true', text: String(n) }),
        el('button', {
          type: 'button', class: 'step-btn', text: '+', 'aria-label': `One more share for ${p.name}`, disabled: n >= LIMITS.maxShares,
          onclick: () => { setShares(item, p.id, n + 1); rerender(); },
        })
      );
    }
    return el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(n > 0), text: p.name,
      onclick: () => { setShares(item, p.id, n > 0 ? 0 : 1); rerender(); },
    });
  });
  if (people.length > 1) {
    chips.push(el('button', {
      type: 'button', class: 'chip chip-all', 'aria-pressed': String(everyone && !item.uneven), text: 'Everyone',
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
        type: 'button', class: 'linkish', text: 'Even shares',
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
      type: 'button', class: 'linkish', text: 'Uneven shares',
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

function renderAddon(addon, parent) {
  const li = el('li', { class: `addon${addon.open ? ' is-open' : ''}`, 'data-item': addon.id });
  const rerender = () => { renderItems(); renderResults(); };

  if (!addon.open) {
    li.append(el('div', { class: 'addon-row' },
      el('span', { class: 'addon-name' }, `+ ${addon.name || 'Add-on'}`, el('small', { text: `Goes with ${parent.name || 'this dish'} · same people` })),
      el('span', { class: 'addon-price', text: addon.cents === null ? '—' : formatMoney(addon.cents) }),
      el('button', { type: 'button', class: 'linkish', text: 'Change', onclick: () => { addon.open = true; rerender(); } })
    ));
    return li;
  }

  const { nameInput, priceInput } = itemInputs(addon, `Add-on ${addon.name || ''}`.trim());
  li.append(
    el('div', { class: 'item-top' }, nameInput,
      el('button', { type: 'button', class: 'x-btn', 'aria-label': 'Remove add-on', text: '×', onclick: () => removeItem(addon.id) })),
    el('div', { class: 'item-price' }, el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), priceInput)),
    el('div', { class: 'item-links' },
      el('button', { type: 'button', class: 'linkish', text: 'Make it its own item', onclick: () => makeOwnItem(addon) }),
      el('button', { type: 'button', class: 'linkish', text: 'Done', onclick: () => closeAddon(addon) }))
  );
  return li;
}

function renderItems() {
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
    const { nameInput, priceInput } = itemInputs(item, `Item ${idx + 1}`);

    li.append(
      el('div', { class: 'item-top' }, nameInput,
        el('button', { type: 'button', class: 'x-btn', 'aria-label': `Remove item ${idx + 1}`, text: '×', onclick: () => removeItem(item.id) })),
      el('div', { class: `item-price${item.guess ? ' guess' : ''}` },
        el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), priceInput),
        ...guessControls(item),
        missing && !item.guess && item.name ? el('span', { class: 'missing-note', text: 'No price found. Enter it or remove this row.' }) : null,
        item.qty > 1 && !isDiscount
          ? el('button', { type: 'button', class: 'linkish split-link', text: `Split into ${item.qty}${item.qtyGuess ? '?' : ''}`, onclick: () => splitQuantity(item) })
          : null,
        isDiscount ? el('button', { type: 'button', class: 'btn-confirm', text: 'Spread over the whole bill', onclick: () => spreadDiscount(item) }) : null
      )
    );
    if (isDiscount) li.append(el('p', { class: 'discount-note', text: 'A discount. Tap who it was for, or spread it over everyone by what they ordered.' }));

    if (item.joined) {
      li.append(el('div', { class: 'item-tags' }, el('span', { class: 'tag tag-joined' },
        el('span', { class: 'tag-text', text: 'Joined from 2 lines' }),
        el('button', { type: 'button', text: 'Split apart', onclick: () => splitApart(item) }))));
    }

    const addons = addonsOf(item);
    if (addons.length) li.append(el('ul', { class: 'addons', 'aria-label': 'Add-ons' }, ...addons.map((a) => renderAddon(a, item))));

    if (!isBlank(item)) {
      const above = tops[idx - 1];
      li.append(el('div', { class: 'item-links' },
        el('button', { type: 'button', class: 'linkish', text: '+ Add an add-on', onclick: () => addAddon(item) }),
        above && !isBlank(above)
          ? el('button', { type: 'button', class: 'linkish', text: `Make it an add-on of ${above.name || 'the item above'}`, onclick: () => makeAddonOf(item, above) })
          : null));
    }

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
const checkSum = () => state.items.reduce((s, i) => s + (i.afterSubtotal ? 0 : i.cents ?? 0), 0);
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
    out.hidden = false;
    if (diff === 0) {
      out.className = 'check ok';
      out.textContent = `Items add up to ${formatMoney(sum)}, matching the receipt's subtotal${guessed ? ' (with a guessed price)' : ''}.`;
    } else {
      short = diff > 0;
      out.className = 'check warn';
      out.textContent = `Items add up to ${formatMoney(sum)}, but the receipt's subtotal is ${formatMoney(subtotalCents)} (${diff > 0 ? 'missing' : 'extra'} ${formatMoney(Math.abs(diff))}). Check the prices against the photo.`;
      const noPrice = state.items.some((i) => i.cents === null && !isBlank(i));
      if (short && !noPrice) {
        out.append(el('br'), el('button', {
          type: 'button', class: 'btn btn-quiet fix-btn', text: `Add the missing ${formatMoney(diff)}`,
          onclick: () => addMissing(diff),
        }));
      }
    }
  }
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
const readTax = () => readMoneyField('tax');
const readFee = () => ($('fee-wrap').hidden ? 0 : readMoneyField('fee'));
function readDisc() {
  if ($('disc-wrap').hidden) return 0;
  const raw = $('disc').value.trim();
  if (!raw) return 0;
  const cents = parseMoney(raw);
  return cents === null ? null : Math.abs(cents); // "-10" and "10" both mean $10 off
}

function showFees(show) { $('fee-wrap').hidden = !show; $('fee-show').hidden = show; }
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
  const moneyInput = (key, label) => {
    const input = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: p[key], 'aria-label': label });
    input.addEventListener('input', () => { p[key] = input.value.slice(0, 20); renderPayerCalcs(); renderResults(); });
    input.addEventListener('blur', () => {
      const c = parseMoney(input.value);
      if (c !== null && c >= 0) { input.value = centsToInput(c); p[key] = input.value; }
    });
    return el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), input);
  };

  if (p.mode === 'percent') {
    const pctInput = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: p.pct, 'aria-label': `${person.name}'s tip percent` });
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
    detail.append(presets, el('div', { class: 'money pct' }, pctInput, el('span', { 'aria-hidden': 'true', text: '%' })));
  } else if (p.mode === 'amount') {
    detail.append(moneyInput('amt', `${person.name}'s tip`));
  } else {
    detail.append(moneyInput('total', `${person.name}'s card total, tip included`));
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
    return el('div', { class: 'payer-block' },
      el('h3', { text: person.name }),
      p.mode === 'total' ? null : el('div', { class: 'payer-row' }, el('span', { text: 'Paid' }), moneyInput('paid', `What ${person.name} paid, before tip`)),
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
    if (r.error) { out.textContent = r.empty ? '' : r.error; continue; }
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
  if (r.error) { out.textContent = $('tip-total').value.trim() ? r.error : ''; return; }
  const pct = pctOfFood(r.cents);
  out.textContent = `Tip works out to ${formatMoney(r.cents)}${pct ? ` (${pct})` : ''}`;
}

function renderResults() {
  const tax = readTax();
  const fee = readFee();
  const disc = readDisc();
  $('tax').setAttribute('aria-invalid', String(tax === null));
  $('fee').setAttribute('aria-invalid', String(fee === null));
  $('disc').setAttribute('aria-invalid', String(disc === null));
  $('disc-to-row').hidden = !(disc > 0);
  renderTotalCalc();
  renderCardsLine();

  const g = gather();
  const blockedEl = $('results-blocked');
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
  blockedEl.replaceChildren();

  const result = computeSplit({ people: state.people, items: realItems(), taxCents: g.tax, tipCents: g.tip, feeCents: g.fee, discountCents: g.disc });
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
  $('preview-img').removeAttribute('src');
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

const STATUS = {
  'loading tesseract core': 'Getting the reader ready…',
  'initializing tesseract': 'Getting the reader ready…',
  'loading language traineddata': 'Loading the English reader…',
  'initializing api': 'Getting the reader ready…',
};

/** Read one image both ways (reader's lines with size data, and rows rebuilt from words). */
async function readImage(worker, canvas) {
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  return bestParse(linesFromBlocks(data.blocks), textFromWords(wordsFromBlocks(data.blocks)), data.text || '');
}

/** A new reading replaces the list, so ask first if anyone's already been assigned. */
function confirmReplace() {
  if (!state.items.some((i) => i.assigned.size > 0)) return true;
  return window.confirm('Reading a new photo replaces the item list and who had what. Go ahead?');
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
  if (!confirmReplace()) return;
  dropPhoto();
  state.photo = file;
  state.previewUrl = URL.createObjectURL(file);
  $('preview-img').src = state.previewUrl;
  await read(async () => decodeImage(file));
}

/** Run the reader on whatever `getSource` produces (the whole photo, or a crop of it). */
async function read(getSource) {
  if (typeof window.Tesseract === 'undefined') {
    showError('The receipt reader didn’t load. Refresh the page and try again.');
    return;
  }
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
          $('busy-text').textContent = pass === 1 ? 'Reading the receipt…' : 'Taking a second look…';
          $('busy-bar').value = Math.round(((pass - 1) * 50) + (m.progress || 0) * 50);
        }
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

    let parsed = await readImage(worker, evened);
    if (token !== state.scanToken) return;
    if (scoreParse(parsed) < 10000) {
      pass = 2;
      const second = await readImage(worker, gray);
      if (token !== state.scanToken) return;
      if (scoreParse(second) > scoreParse(parsed)) parsed = second;
    }
    applyParsed(parsed);
    showReceiptState('done');
  } catch (err) {
    if (token !== state.scanToken) return;
    console.error(err);
    if (state.photo) {
      showReceiptState('done');
      showError('Couldn’t read that. Try cropping again, or use a different photo.');
    } else {
      dropPhoto();
      showReceiptState('empty');
      showError('Couldn’t read that photo. Try again with the receipt flat and well lit, or type the items in.');
    }
  } finally {
    if (worker) worker.terminate().catch(() => {});
    for (const c of [gray, evened]) if (c) { c.width = 0; c.height = 0; }
  }
}

function resetTip() {
  $('tip-amt').value = '';
  $('tip-total').value = '';
  state.gratuityFromReceipt = false;
  setTipMode('percent');
}

function applyParsed(parsed, { append = false, noteEl = $('receipt-note') } = {}) {
  hideUndo();
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

  if (append) {
    if (parsed.subtotalCents !== null) state.receipt.subtotalCents = parsed.subtotalCents;
    if (parsed.totalCents !== null) state.receipt.totalCents = parsed.totalCents;
    if (parsed.taxCents !== null && !$('tax').value.trim()) $('tax').value = centsToInput(parsed.taxCents);
  } else {
    // A new receipt starts clean: nothing carried over from the last one.
    state.receipt = { subtotalCents: parsed.subtotalCents, totalCents: parsed.totalCents };
    $('tax').value = parsed.taxCents !== null ? centsToInput(parsed.taxCents) : '';
    $('fee').value = '';
    $('disc').value = '';
    state.discNames = [];
    showFees(false);
    showDisc(false);
    resetTip();
  }
  if (parsed.feeCents && !$('fee').value.trim()) {
    $('fee').value = centsToInput(parsed.feeCents);
    showFees(true);
  }
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
      ? 'No prices found in that text. Each item needs its price on the same line, like “Iced Tea 3.75”.'
      : 'No prices found in that photo. Try a sharper shot or crop it, or add the items by hand below.';
  } else {
    const found = [`${dishes} item${dishes === 1 ? '' : 's'}`];
    if (extras) found.push(`${extras} add-on${extras === 1 ? '' : 's'}`);
    if (discounts) found.push(`${discounts} discount${discounts === 1 ? '' : 's'}`);
    const bits = [`Found ${listAnd(found)}`];
    if (parsed.taxCents !== null) bits.push(`${formatMoney(parsed.taxCents)} tax`);
    if (parsed.feeCents) bits.push(`${formatMoney(parsed.feeCents)} in fees`);
    if (parsed.tipCents !== null) bits.push(`${formatMoney(parsed.tipCents)} ${parsed.gratuity ? 'gratuity' : 'tip'}`);
    noteEl.textContent = `${bits.join(', ')}. Check them against the ${append ? 'receipt' : 'photo'} before splitting.`;
  }

  renderTipNote();
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
  if (!confirmReplace()) return;
  const img = crop.img;
  crop.img = null; // the reader owns it now
  const r = state.crop;
  $('crop').hidden = true;
  document.body.classList.remove('no-scroll');
  const canvas = $('crop-canvas');
  canvas.width = 0;
  canvas.height = 0;
  await read(async () => {
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
  applyParsed(parsed, { append: true, noteEl: $('paste-note') });
  if (parsed.items.length) setPasteOpen(false); // clears the box
}

/* ------------------------------------------------------------------- reset */

function resetAll() {
  const hasData = state.people.length || state.items.length || state.previewUrl;
  if (hasData && !window.confirm('Clear everything and start over?')) return;
  state.scanToken++;
  hideUndo();
  dropPhoto();
  state.people = [];
  state.payerIds = new Set();
  state.pay = new Map();
  state.items = [];
  state.receipt = { subtotalCents: null, totalCents: null };
  state.discNames = [];
  for (const id of ['tax', 'fee', 'disc', 'tip-amt', 'tip-total', 'person-name', 'copy-fallback-text']) $(id).value = '';
  $('tip-pct').value = '20';
  $('receipt-note').textContent = '';
  $('paste-note').textContent = '';
  $('copy-fallback').hidden = true;
  showFees(false);
  showDisc(false);
  setPasteOpen(false);
  syncTipPresets();
  resetTip();
  showError('');
  showReceiptState('empty');
  renderAll();
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('crop').hidden) closeCrop(); });
window.addEventListener('resize', () => { if (!$('crop').hidden && crop.img) drawCrop(); });

$('manual').addEventListener('click', () => addItem());
$('item-add').addEventListener('click', () => addItem());
$('person-add').addEventListener('click', addPerson);
$('person-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPerson(); }
});
for (const id of ['tax', 'fee', 'disc', 'tip-total']) {
  $(id).addEventListener('input', () => { renderPayerCalcs(); renderResults(); });
  $(id).addEventListener('blur', () => {
    const c = parseMoney($(id).value);
    if (c !== null) $(id).value = centsToInput(Math.abs(c));
  });
}
$('fee-show').addEventListener('click', () => { showFees(true); $('fee').focus(); });
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
$('undo-btn').addEventListener('click', undo);
$('reset').addEventListener('click', resetAll);
$('paste-toggle').addEventListener('click', () => { $('paste-note').textContent = ''; setPasteOpen(true); });
$('paste-cancel').addEventListener('click', () => setPasteOpen(false));
$('paste-read').addEventListener('click', readPasted);
$('copy-fallback-close').addEventListener('click', () => {
  $('copy-fallback').hidden = true;
  $('copy-fallback-text').value = '';
});

renderAll();
