import { parseMoney, parsePercent, formatMoney, centsToInput, computeSplit, splitEven } from './split.js';
import { bestParse, pairColumns, textFromWords, wordsFromBlocks, linesFromBlocks, scoreParse } from './parse.js';

// Everything lives in this object, in memory only. No localStorage, no cookies,
// no IndexedDB, no network writes. Refreshing the page wipes it.
const state = {
  people: [], // { id, name }
  payerId: null,
  items: [], // see makeItem()
  tipMode: 'percent',
  receipt: { subtotalCents: null, totalCents: null },
  gratuityFromReceipt: false,
  previewUrl: null,
  scanToken: 0,
};

const LIMITS = { people: 30, items: 150, nameLen: 30, itemLen: 60, fileBytes: 25 * 1024 * 1024, pasteChars: 20000, maxShares: 9 };

let idCounter = 0;
const newId = () => `id${++idCounter}`;

const $ = (id) => document.getElementById(id);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
 *   addon, parentId, custom (add-on assigned separately from its dish), open (add-on editor shown),
 *   joined: { base, extra } | null, qty,
 *   guess: null | 'guessed' | 'added'   (price came from the subtotal, not confirmed yet)
 * }
 */
function makeItem({ name = '', cents = null, qty = 1, addon = false, parentId = null, joined = null } = {}) {
  return {
    id: newId(), name: cleanText(name, LIMITS.itemLen), cents, rawPrice: '',
    assigned: new Map(), uneven: false,
    addon, parentId, custom: false, open: false,
    joined, qty, guess: null,
  };
}

const byId = (id) => state.items.find((i) => i.id === id);
const addonsOf = (item) => state.items.filter((i) => i.addon && i.parentId === item.id);
const isTop = (item) => !item.addon || !byId(item.parentId);
const topItems = () => state.items.filter(isTop);

/** A top-level row with no name and no price is a placeholder, not an item. */
const isBlank = (item) => isTop(item) && !item.name && item.cents === null && !item.rawPrice;
const realItems = () => state.items.filter((i) => !isBlank(i));

/** Add-ons follow their dish's people unless someone reassigned them. */
function syncAddons(parent) {
  for (const a of addonsOf(parent)) {
    if (!a.custom) {
      a.assigned = new Map(parent.assigned);
      a.uneven = parent.uneven;
    }
  }
}

function setShares(item, pid, n) {
  if (n <= 0) item.assigned.delete(pid);
  else item.assigned.set(pid, Math.min(LIMITS.maxShares, n));
  if (item.assigned.size < 2) {
    item.uneven = false;
    for (const k of item.assigned.keys()) item.assigned.set(k, 1);
  }
  if (!item.addon) syncAddons(item);
}

/* ------------------------------------------------------------------ people */

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
  if (state.people.length === 1) state.payerId = person.id;
  input.value = '';
  input.focus();
  renderPeople();
  renderItems();
  renderResults();
}

function removePerson(id) {
  state.people = state.people.filter((p) => p.id !== id);
  state.items.forEach((item) => setShares(item, id, 0));
  if (state.payerId === id) state.payerId = null;
  renderPeople();
  renderItems();
  renderResults();
}

function renderPeople() {
  $('people').replaceChildren(
    ...state.people.map((p) =>
      el('li', { class: 'person' },
        el('span', { class: 'person-name', text: p.name }),
        el('button', {
          type: 'button',
          class: 'payer-btn',
          'aria-pressed': String(state.payerId === p.id),
          'aria-label': `${p.name} paid the bill`,
          text: state.payerId === p.id ? 'Paid' : 'Mark as payer',
          onclick: () => {
            state.payerId = state.payerId === p.id ? null : p.id;
            renderPeople();
            renderResults();
          },
        }),
        el('button', { type: 'button', class: 'x-btn', 'aria-label': `Remove ${p.name}`, text: '×', onclick: () => removePerson(p.id) })
      )
    )
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

function removeItem(id) {
  const item = byId(id);
  if (!item) return;
  // Add-ons of a removed dish stay on the bill as their own rows.
  for (const a of addonsOf(item)) { a.addon = false; a.parentId = null; a.open = false; }
  state.items = state.items.filter((i) => i.id !== id);
  renderItems();
  renderResults();
}

function splitApart(item) {
  if (!item.joined) return;
  const { base, extra } = item.joined;
  const suffix = ` ${extra}`;
  if (item.name.endsWith(suffix)) item.name = item.name.slice(0, -suffix.length);
  else if (item.name === `${base}${suffix}`.slice(0, LIMITS.itemLen)) item.name = base;
  item.joined = null;
  const row = makeItem({ name: extra });
  const at = state.items.indexOf(item) + 1 + addonsOf(item).length;
  state.items.splice(at, 0, row);
  renderItems();
  renderResults();
  focusItem(row.id, 1);
}

function splitQuantity(item) {
  const n = item.qty;
  if (n < 2 || state.items.length + n - 1 > LIMITS.items) return;
  const parts = item.cents === null ? new Array(n).fill(null) : splitEven(item.cents, n);
  const copies = parts.map((c, k) => (k === 0 ? item : makeItem({ name: item.name, cents: c })));
  item.cents = parts[0];
  item.qty = 1;
  item.assigned = new Map();
  item.uneven = false;
  syncAddons(item);
  const at = state.items.indexOf(item) + 1 + addonsOf(item).length;
  state.items.splice(at, 0, ...copies.slice(1));
  renderItems();
  renderResults();
}

/** Name and price inputs, shared by dishes and opened add-ons. */
function itemInputs(item, label) {
  const nameInput = el('input', {
    type: 'text', value: item.name, maxlength: LIMITS.itemLen, autocomplete: 'off',
    placeholder: item.guess === 'added' ? 'What was it?' : 'Item', enterkeyhint: 'next', 'aria-label': `${label} name`,
  });
  const priceInput = el('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', enterkeyhint: 'next',
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
    renderResults();
  });
  priceInput.addEventListener('change', () => {
    // Typing a price yourself counts as checking it.
    if (item.guess) { item.guess = null; renderItems(); renderResults(); }
  });
  priceInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (item.guess) { item.guess = null; renderItems(); renderResults(); }
    if (item.addon) return;
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
        // Everyone already on evenly -> clear. Otherwise everyone gets one share.
        const clear = everyone && !item.uneven;
        item.uneven = false;
        item.assigned = clear ? new Map() : new Map(people.map((p) => [p.id, 1]));
        if (!item.addon) syncAddons(item);
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
          if (!item.addon) syncAddons(item);
          rerender();
        },
      })
    ));
  } else if (item.assigned.size >= 2) {
    wrap.append(el('button', {
      type: 'button', class: 'linkish', text: 'Uneven shares',
      onclick: () => { item.uneven = true; if (!item.addon) syncAddons(item); rerender(); },
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
    const sub = addon.custom ? 'Assigned separately' : `Goes with ${parent.name || 'this dish'} · same people`;
    li.append(el('div', { class: 'addon-row' },
      el('span', { class: 'addon-name' }, `+ ${addon.name || 'Add-on'}`, el('small', { text: sub })),
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
  );
  if (state.people.length) {
    const editWrap = el('div', { class: 'addon-edit' });
    const assignRerender = () => { addon.custom = true; rerender(); };
    editWrap.append(chipsFor(addon, assignRerender));
    li.append(editWrap);
  }
  li.append(el('div', {},
    addon.custom
      ? el('button', {
          type: 'button', class: 'linkish', text: 'Same people as the dish',
          onclick: () => { addon.custom = false; syncAddons(parent); rerender(); },
        })
      : null,
    el('button', { type: 'button', class: 'linkish', text: 'Done', onclick: () => { addon.open = false; rerender(); } })
  ));
  return li;
}

function renderItems() {
  const list = $('items');
  const tops = topItems();
  const rows = tops.map((item, idx) => {
    const missing = item.cents === null && !isBlank(item);
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
        missing && !item.guess && item.name ? el('span', { class: 'missing-note', text: 'No price found. Enter it or remove this row.' }) : null
      )
    );

    const tags = [];
    if (item.joined) {
      tags.push(el('span', { class: 'tag tag-joined' },
        el('span', { class: 'tag-text', text: 'Joined from 2 lines' }),
        el('button', { type: 'button', text: 'Split apart', onclick: () => splitApart(item) })));
    }
    if (item.qty > 1) {
      tags.push(el('span', { class: 'tag' },
        `${item.qty}× on the receipt`,
        el('button', { type: 'button', text: `Split into ${item.qty}`, onclick: () => splitQuantity(item) })));
    }
    if (tags.length) li.append(el('div', { class: 'item-tags' }, ...tags));

    const addons = addonsOf(item);
    if (addons.length) li.append(el('ul', { class: 'addons', 'aria-label': 'Add-ons' }, ...addons.map((a) => renderAddon(a, item))));

    if (state.people.length) li.append(chipsFor(item, rerender));
    return li;
  });

  list.replaceChildren(...rows);
  $('item-add').disabled = state.items.length >= LIMITS.items;
  $('items-hint').hidden = state.items.length > 0 && state.people.length > 0;
  renderCheck();
}

const itemsSum = () => state.items.reduce((s, i) => s + (i.cents ?? 0), 0);

/** Compare the items against the receipt's subtotal to catch misreads. */
function renderCheck() {
  const out = $('items-check');
  const { subtotalCents } = state.receipt;
  let short = false;
  if (subtotalCents === null || realItems().length === 0) {
    out.hidden = true;
  } else {
    const sum = itemsSum();
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
  const diff = subtotalCents - itemsSum();
  if (diff > 0) {
    open[0].cents = diff;
    open[0].guess = 'guessed';
  }
}

/* -------------------------------------------------------- tax, fees and tip */

function readMoneyField(id) {
  const raw = $(id).value.trim();
  if (!raw) return 0;
  const cents = parseMoney(raw);
  return cents !== null && cents >= 0 ? cents : null;
}
const readTax = () => readMoneyField('tax');
const readFee = () => ($('fee-wrap').hidden ? 0 : readMoneyField('fee'));

function readTip() {
  if (state.tipMode === 'amount') return readMoneyField('tip-amt');
  const pct = parsePercent($('tip-pct').value);
  if (pct === null) return null;
  return Math.round((Math.max(0, itemsSum()) * pct) / 100);
}

function syncTipPresets() {
  const pct = parsePercent($('tip-pct').value);
  document.querySelectorAll('#tip-presets .chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(pct !== null && Number(b.dataset.pct) === pct));
  });
}

function setTipMode(mode) {
  state.tipMode = mode === 'amount' ? 'amount' : 'percent';
  document.querySelectorAll('input[name="tip-mode"]').forEach((r) => { r.checked = r.value === state.tipMode; });
  $('tip-percent-wrap').hidden = state.tipMode !== 'percent';
  $('tip-amount-wrap').hidden = state.tipMode !== 'amount';
  renderTipNote();
  renderResults();
}

function renderTipNote() {
  const note = $('tip-note');
  const show = state.gratuityFromReceipt && state.tipMode === 'amount';
  note.hidden = !show;
  note.textContent = show ? 'This receipt already includes a gratuity. It’s filled in as the tip, so don’t add another.' : '';
}

function showFees(show) {
  $('fee-wrap').hidden = !show;
  $('fee-show').hidden = show;
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

/** The first thing stopping the split, and which item to jump to for it. */
function blocker(tax, tip, fee) {
  if (!state.people.length) return { text: 'Add the people splitting the bill.' };
  if (!realItems().length) return { text: 'Add the items from the receipt.' };
  const label = (i) => i.name || `the ${i.cents === null ? 'unnamed' : formatMoney(i.cents)} item`;

  const noPrice = state.items.find((i) => i.cents === null && !isBlank(i));
  if (noPrice) return { text: `${label(noPrice)} needs a price. Tap to jump to it.`, id: noPrice.id };
  const guess = state.items.find((i) => i.guess);
  if (guess) return { text: `Confirm the guessed price for ${label(guess)}. Tap to jump to it.`, id: guess.id };
  if (tax === null) return { text: 'The tax amount doesn’t look like a dollar amount.' };
  if (fee === null) return { text: 'The fee amount doesn’t look like a dollar amount.' };
  if (tip === null) return { text: state.tipMode === 'percent' ? 'The tip percent should be a number from 0 to 100.' : 'The tip amount doesn’t look like a dollar amount.' };

  const open = realItems().filter((i) => i.assigned.size === 0 && (isTop(i) || i.custom));
  if (open.length) {
    const names = open.slice(0, 3).map(label).join(', ');
    const more = open.length > 3 ? ` and ${open.length - 3} more` : '';
    return { text: `Still unclaimed: ${names}${more}. Tap to jump to ${open.length === 1 ? 'it' : 'the first one'}.`, id: open[0].id };
  }
  return null;
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

function owesText(row, payer, grand) {
  if (!payer) return null;
  if (payer.id === row.id) return `Covered the bill. Gets back ${formatMoney(grand - row.total)}`;
  if (row.total > 0) return `Pays ${payer.name} back ${formatMoney(row.total)}`;
  return null;
}

/** Plain text for pasting into a message. No alignment, no symbols that turn into boxes. */
function slipText(row, payer, result) {
  const out = [`${row.name}'s share`];
  for (const l of row.lines) out.push(`${l.addon ? '+ ' : ''}${l.name}${lineText(l)}: ${formatMoney(l.cents)}`);
  out.push(`Food & drink: ${formatMoney(row.subtotal)}`);
  out.push(`Tax: ${formatMoney(row.tax)}`);
  if (result.feeCents) out.push(`Fees: ${formatMoney(row.fee)}`);
  out.push(`Tip: ${formatMoney(row.tip)}`);
  out.push(`Total: ${formatMoney(row.total)}`);
  const owes = owesText(row, payer, result.grandTotal);
  if (owes) out.push(owes);
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

function renderResults() {
  const tax = readTax();
  const tip = readTip();
  const fee = readFee();
  $('tax').setAttribute('aria-invalid', String(tax === null));
  $('fee').setAttribute('aria-invalid', String(fee === null));
  $('tip-pct').setAttribute('aria-invalid', String(state.tipMode === 'percent' && tip === null));
  $('tip-amt').setAttribute('aria-invalid', String(state.tipMode === 'amount' && tip === null));

  const block = blocker(tax, tip, fee);
  const blockedEl = $('results-blocked');
  if (block) {
    blockedEl.replaceChildren(
      block.id ? el('button', { type: 'button', class: 'blocked-link', text: block.text, onclick: () => jumpTo(block.id) }) : block.text
    );
    $('slips').replaceChildren();
    $('results-foot').hidden = true;
    $('copy-all').hidden = true;
    return;
  }
  blockedEl.replaceChildren();

  const result = computeSplit({ people: state.people, items: realItems(), taxCents: tax, tipCents: tip, feeCents: fee });
  const payer = state.people.find((p) => p.id === state.payerId);

  const slips = result.rows.map((row) => {
    const isPayer = payer && payer.id === row.id;
    const lines = row.lines.length
      ? row.lines.map((l) => {
          const extra = lineLabel(l);
          return el('li', { class: 'slip-line' },
            el('span', {}, `${l.addon ? '+ ' : ''}${l.name}`, extra ? el('span', { class: 'shared', text: ` ${extra}` }) : null),
            el('span', { text: formatMoney(l.cents) }));
        })
      : [el('li', { class: 'slip-line' }, el('span', { class: 'shared', text: 'Nothing assigned' }), el('span', { text: '' }))];

    const owes = owesText(row, payer, result.grandTotal);
    const label = `Copy ${row.name}'s share`;
    const copyBtn = el('button', { type: 'button', class: 'copy-btn', text: label });
    copyBtn.addEventListener('click', () => copyText(slipText(row, payer, result), copyBtn, 'Copied', label));

    return el('div', { class: 'slip-wrap' },
      el('article', { class: 'slip', 'aria-label': `${row.name}'s share` },
        el('div', { class: 'slip-head' },
          el('span', { class: 'slip-name', text: row.name }),
          isPayer ? el('span', { class: 'slip-tag payer', text: 'Paid' }) : null),
        el('ul', { class: 'slip-lines' }, ...lines),
        el('div', { class: 'slip-sums' },
          el('div', { class: 'slip-sum' }, el('span', { text: 'Food & drink' }), el('span', { text: formatMoney(row.subtotal) })),
          el('div', { class: 'slip-sum' }, el('span', { text: 'Tax' }), el('span', { text: formatMoney(row.tax) })),
          result.feeCents ? el('div', { class: 'slip-sum' }, el('span', { text: 'Fees' }), el('span', { text: formatMoney(row.fee) })) : null,
          el('div', { class: 'slip-sum' }, el('span', { text: 'Tip' }), el('span', { text: formatMoney(row.tip) }))),
        el('div', { class: 'slip-total' }, el('span', { text: 'Total' }), el('span', { text: formatMoney(row.total) })),
        owes ? el('p', { class: 'slip-owes', text: owes }) : null),
      el('div', { class: 'copy-row' }, copyBtn)
    );
  });

  $('slips').replaceChildren(...slips);

  const allBtn = $('copy-all');
  allBtn.hidden = result.rows.length < 2;
  allBtn.onclick = () => {
    const text = result.rows.map((r) => slipText(r, payer, result)).join('\n\n') + `\n\nEveryone together: ${formatMoney(result.grandTotal)}`;
    copyText(text, allBtn, 'Copied everyone', 'Copy everyone\'s shares');
  };

  const foot = $('results-foot');
  const feePart = result.feeCents ? ` + ${formatMoney(result.feeCents)} fees` : '';
  let text = `Everyone together: ${formatMoney(result.grandTotal)} (${formatMoney(result.itemsTotal)} + ${formatMoney(tax)} tax${feePart} + ${formatMoney(tip)} tip).`;
  const { totalCents } = state.receipt;
  if (totalCents !== null) {
    if (totalCents === result.grandTotal) text += ' Matches the total on the receipt.';
    else if (totalCents === result.grandTotal - tip) text += ' Matches the receipt total plus your tip.';
  }
  foot.textContent = text;
  foot.hidden = false;
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

function dropPreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
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

/** Resize to a size the reader likes and convert to grayscale. */
function grayCanvas(source) {
  const longSide = Math.max(source.width, source.height);
  let scale = 1;
  if (longSide > 2400) scale = 2400 / longSide;
  else if (longSide < 1400) scale = 1400 / longSide;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

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
  if (typeof source.close === 'function') source.close();
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
      // 90th percentile of the block, from a coarse histogram
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
  // Smooth the background estimate so block edges don't show.
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
      const i00 = y0 * gw + x0;
      const x1 = Math.min(gw - 1, x0 + 1);
      const y1 = Math.min(gh - 1, y0 + 1);
      const bg = (smooth[i00] * (1 - tx) + smooth[y0 * gw + x1] * tx) * (1 - ty)
        + (smooth[y1 * gw + x0] * (1 - tx) + smooth[y1 * gw + x1] * tx) * ty;
      const p = (y * w + x) * 4;
      const v = Math.min(255, (d[p] * 245) / bg);
      d[p] = v;
      hist[v | 0]++;
    }
  }
  // Stretch: darkest 1% becomes black.
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
  if (typeof window.Tesseract === 'undefined') {
    showError('The receipt reader didn’t load. Refresh the page and try again.');
    return;
  }

  const token = ++state.scanToken;
  dropPreview();
  state.previewUrl = URL.createObjectURL(file);
  $('preview-img').src = state.previewUrl;
  showReceiptState('busy');
  $('busy-text').textContent = 'Getting the reader ready…';
  $('busy-bar').value = 0;

  let worker = null;
  let gray = null;
  let evened = null;
  let pass = 1;
  try {
    const source = await decodeImage(file);
    gray = grayCanvas(source);
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
    // If the items don't add up to the subtotal, read the plain version too and keep the better one.
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
    dropPreview();
    showReceiptState('empty');
    showError('Couldn’t read that photo. Try again with the receipt flat and well lit, or type the items in.');
  } finally {
    if (worker) worker.terminate().catch(() => {});
    for (const c of [gray, evened]) if (c) { c.width = 0; c.height = 0; }
  }
}

function applyParsed(parsed, { append = false, noteEl = $('receipt-note') } = {}) {
  state.items = append ? state.items.filter((i) => !isBlank(i)) : [];
  let room = LIMITS.items - state.items.length;
  const created = [];
  parsed.items.forEach((p, idx) => {
    if (room <= 0) return;
    const parent = p.addon ? created[p.parent] : null;
    const item = makeItem({ name: p.name, cents: p.cents, qty: p.qty || 1, joined: p.joined, addon: Boolean(parent), parentId: parent ? parent.id : null });
    created[idx] = item;
    state.items.push(item);
    room--;
  });

  if (append) {
    if (parsed.subtotalCents !== null) state.receipt.subtotalCents = parsed.subtotalCents;
    if (parsed.totalCents !== null) state.receipt.totalCents = parsed.totalCents;
    if (parsed.taxCents !== null && !$('tax').value.trim()) $('tax').value = centsToInput(parsed.taxCents);
  } else {
    state.receipt = { subtotalCents: parsed.subtotalCents, totalCents: parsed.totalCents };
    $('tax').value = parsed.taxCents !== null ? centsToInput(parsed.taxCents) : '';
    $('fee').value = '';
    state.gratuityFromReceipt = false;
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

  const dishes = created.filter((i) => i && !i.addon).length;
  const extras = created.filter((i) => i && i.addon).length;
  if (parsed.cardSlip) {
    noteEl.textContent = 'This looks like the card slip, not the itemized check. Take a photo of the check that lists the dishes.';
  } else if (dishes + extras === 0) {
    noteEl.textContent = append
      ? 'No prices found in that text. Each item needs its price on the same line, like “Iced Tea 3.75”.'
      : 'No prices found in that photo. Try a sharper shot, or add the items by hand below.';
  } else {
    const bits = [`Found ${dishes} item${dishes === 1 ? '' : 's'}${extras ? ` and ${extras} add-on${extras === 1 ? '' : 's'}` : ''}`];
    if (parsed.taxCents !== null) bits.push(`${formatMoney(parsed.taxCents)} tax`);
    if (parsed.feeCents) bits.push(`${formatMoney(parsed.feeCents)} in fees`);
    if (parsed.tipCents !== null) bits.push(`${formatMoney(parsed.tipCents)} ${parsed.gratuity ? 'gratuity' : 'tip'}`);
    noteEl.textContent = `${bits.join(', ')}. Check them against the ${append ? 'receipt' : 'photo'} before splitting.`;
  }

  renderTipNote();
  renderItems();
  renderResults();
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
  dropPreview();
  state.people = [];
  state.payerId = null;
  state.items = [];
  state.receipt = { subtotalCents: null, totalCents: null };
  state.gratuityFromReceipt = false;
  for (const id of ['tax', 'fee', 'tip-amt', 'person-name', 'copy-fallback-text']) $(id).value = '';
  $('tip-pct').value = '20';
  $('receipt-note').textContent = '';
  $('paste-note').textContent = '';
  $('copy-fallback').hidden = true;
  showFees(false);
  setPasteOpen(false);
  syncTipPresets();
  setTipMode('percent');
  showError('');
  showReceiptState('empty');
  renderPeople();
  renderItems();
  renderResults();
  window.scrollTo({ top: 0 });
}

/* -------------------------------------------------------------------- wire */

function onPick(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ''; // let go of the file reference right away
  scan(file);
}

$('photo').addEventListener('change', onPick);
$('photo-again').addEventListener('change', onPick);
$('photo-remove').addEventListener('click', () => {
  state.scanToken++;
  dropPreview();
  $('receipt-note').textContent = '';
  showReceiptState('empty');
});
$('manual').addEventListener('click', () => addItem());
$('item-add').addEventListener('click', () => addItem());
$('person-add').addEventListener('click', addPerson);
$('person-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addPerson(); }
});
for (const id of ['tax', 'fee']) {
  $(id).addEventListener('input', renderResults);
  $(id).addEventListener('blur', () => {
    const c = parseMoney($(id).value);
    if (c !== null && c >= 0) $(id).value = centsToInput(c);
  });
}
$('fee-show').addEventListener('click', () => { showFees(true); $('fee').focus(); });
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
$('reset').addEventListener('click', resetAll);
$('paste-toggle').addEventListener('click', () => { $('paste-note').textContent = ''; setPasteOpen(true); });
$('paste-cancel').addEventListener('click', () => setPasteOpen(false));
$('paste-read').addEventListener('click', readPasted);
$('copy-fallback-close').addEventListener('click', () => {
  $('copy-fallback').hidden = true;
  $('copy-fallback-text').value = '';
});

renderPeople();
renderItems();
renderResults();
