import { parseMoney, parsePercent, formatMoney, centsToInput, computeSplit } from './split.js';
import { bestParse, pairColumns, textFromWords, wordsFromBlocks } from './parse.js';

// Everything lives in this object, in memory only. No localStorage, no cookies,
// no IndexedDB, no network writes. Refreshing the page wipes it.
const state = {
  people: [],       // { id, name }
  payerId: null,
  items: [],        // { id, name, cents (int | null), assigned: Set<personId> }
  tipMode: 'percent',
  receipt: { subtotalCents: null, totalCents: null },
  previewUrl: null,
  scanToken: 0,
};

const LIMITS = { people: 30, items: 150, nameLen: 30, itemLen: 60, fileBytes: 25 * 1024 * 1024, pasteChars: 20000 };

let idCounter = 0;
const newId = () => `id${++idCounter}`;

const $ = (id) => document.getElementById(id);

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
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
}

const cleanText = (s, max) => String(s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

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
  state.items.forEach((item) => item.assigned.delete(id));
  if (state.payerId === id) state.payerId = null;
  renderPeople();
  renderItems();
  renderResults();
}

function renderPeople() {
  const list = $('people');
  list.replaceChildren(
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
        el('button', {
          type: 'button',
          class: 'x-btn',
          'aria-label': `Remove ${p.name}`,
          text: '×',
          onclick: () => removePerson(p.id),
        })
      )
    )
  );
  $('person-add').disabled = state.people.length >= LIMITS.people;
}

/* ------------------------------------------------------------------- items */

/** A row with no name and no price is a placeholder, not an item. */
const isBlank = (item) => !item.name && item.cents === null && !item.rawPrice;
const realItems = () => state.items.filter((i) => !isBlank(i));

function focusItem(id, field = 0) {
  document.querySelectorAll(`[data-item="${id}"] input`)[field]?.focus();
}

function addItem(name = '', cents = null, focus = true) {
  const last = state.items[state.items.length - 1];
  if (focus && !name && cents === null && last && isBlank(last)) {
    focusItem(last.id);
    return last;
  }
  if (state.items.length >= LIMITS.items) return null;
  const item = { id: newId(), name: cleanText(name, LIMITS.itemLen), cents, rawPrice: '', assigned: new Set() };
  state.items.push(item);
  if (focus) {
    renderItems();
    renderResults();
    focusItem(item.id);
  }
  return item;
}

function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  renderItems();
  renderResults();
}

function chipsFor(item, li) {
  const everyone = state.people.length > 0 && state.people.every((p) => item.assigned.has(p.id));
  const chips = state.people.map((p) =>
    el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(item.assigned.has(p.id)),
      text: p.name,
      onclick: () => {
        if (item.assigned.has(p.id)) item.assigned.delete(p.id);
        else item.assigned.add(p.id);
        refreshItemChips(item, li);
        renderResults();
      },
    })
  );
  if (state.people.length > 1) {
    chips.push(
      el('button', {
        type: 'button',
        class: 'chip chip-all',
        'aria-pressed': String(everyone),
        text: 'Everyone',
        onclick: () => {
          item.assigned = everyone ? new Set() : new Set(state.people.map((p) => p.id));
          refreshItemChips(item, li);
          renderResults();
        },
      })
    );
  }
  return el('div', { class: 'chips', role: 'group', 'aria-label': 'Who had this' }, ...chips);
}

function refreshItemChips(item, li) {
  li.querySelector('.chips')?.replaceWith(chipsFor(item, li));
  li.classList.toggle('is-assigned', item.assigned.size > 0);
}

function renderItems() {
  const list = $('items');
  const rows = state.items.map((item, idx) => {
    const li = el('li', { class: `item${item.assigned.size ? ' is-assigned' : ''}`, 'data-item': item.id });

    const nameInput = el('input', {
      type: 'text',
      value: item.name,
      maxlength: LIMITS.itemLen,
      autocomplete: 'off',
      placeholder: 'Item',
      enterkeyhint: 'next',
      'aria-label': `Item ${idx + 1} name`,
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

    const priceInput = el('input', {
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      placeholder: '0.00',
      enterkeyhint: 'next',
      value: item.cents === null ? '' : centsToInput(item.cents),
      'aria-label': `Item ${idx + 1} price`,
      'aria-invalid': 'false',
    });
    priceInput.addEventListener('input', () => {
      const cents = parseMoney(priceInput.value);
      item.cents = cents;
      item.rawPrice = priceInput.value.trim().slice(0, 20);
      priceInput.setAttribute('aria-invalid', String(cents === null && priceInput.value.trim() !== ''));
      renderCheck();
      renderResults();
    });
    priceInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const pos = state.items.indexOf(item);
      const next = state.items[pos + 1];
      if (next) focusItem(next.id);
      else if (!isBlank(item)) addItem();
    });
    priceInput.addEventListener('blur', () => {
      if (item.cents !== null) priceInput.value = centsToInput(item.cents);
    });

    const top = el('div', { class: 'item-top' },
      nameInput,
      el('div', { class: 'money' }, el('span', { 'aria-hidden': 'true', text: '$' }), priceInput),
      el('button', {
        type: 'button',
        class: 'x-btn',
        'aria-label': `Remove item ${idx + 1}`,
        text: '×',
        onclick: () => removeItem(item.id),
      })
    );

    li.append(top);
    if (state.people.length) li.append(chipsFor(item, li));
    return li;
  });

  list.replaceChildren(...rows);
  $('item-add').disabled = state.items.length >= LIMITS.items;
  $('items-hint').hidden = state.items.length > 0 && state.people.length > 0;
  renderCheck();
}

function itemsSum() {
  return state.items.reduce((s, i) => s + (i.cents ?? 0), 0);
}

/** Compare what we parsed against what the receipt says, to catch misreads. */
function renderCheck() {
  const out = $('items-check');
  const { subtotalCents } = state.receipt;
  if (subtotalCents === null || realItems().length === 0) {
    out.hidden = true;
    return;
  }
  const sum = itemsSum();
  out.hidden = false;
  if (sum === subtotalCents) {
    out.className = 'check ok';
    out.textContent = `Items add up to ${formatMoney(sum)}, matching the receipt's subtotal.`;
  } else {
    out.className = 'check warn';
    const diff = subtotalCents - sum;
    out.textContent = `Items add up to ${formatMoney(sum)}, but the receipt's subtotal is ${formatMoney(subtotalCents)} (${diff > 0 ? 'missing' : 'extra'} ${formatMoney(Math.abs(diff))}). Check the prices against the photo.`;
  }
}

/* ------------------------------------------------------------- tax and tip */

function readTax() {
  const raw = $('tax').value.trim();
  if (!raw) return 0;
  const cents = parseMoney(raw);
  return cents !== null && cents >= 0 ? cents : null;
}

function readTip() {
  if (state.tipMode === 'amount') {
    const raw = $('tip-amt').value.trim();
    if (!raw) return 0;
    const cents = parseMoney(raw);
    return cents !== null && cents >= 0 ? cents : null;
  }
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
  renderResults();
}

/* ----------------------------------------------------------------- results */

function blockerMessage(tax, tip) {
  if (!state.people.length) return 'Add the people splitting the bill.';
  if (!realItems().length) return 'Add the items from the receipt.';
  const badPrice = state.items.findIndex((i) => i.cents === null && !isBlank(i));
  if (badPrice !== -1) return `Item ${badPrice + 1} needs a price.`;
  if (tax === null) return 'The tax amount doesn’t look like a dollar amount.';
  if (tip === null) return state.tipMode === 'percent' ? 'The tip percent should be a number from 0 to 100.' : 'The tip amount doesn’t look like a dollar amount.';
  const open = realItems().filter((i) => i.assigned.size === 0);
  if (open.length) {
    const names = open.slice(0, 3).map((i) => i.name || 'unnamed item').join(', ');
    const more = open.length > 3 ? ` and ${open.length - 3} more` : '';
    return `Still unclaimed: ${names}${more}. Tap who had ${open.length === 1 ? 'it' : 'each one'}.`;
  }
  return '';
}

function renderResults() {
  const tax = readTax();
  const tip = readTip();
  $('tax').setAttribute('aria-invalid', String(tax === null));
  $('tip-pct').setAttribute('aria-invalid', String(state.tipMode === 'percent' && tip === null));
  $('tip-amt').setAttribute('aria-invalid', String(state.tipMode === 'amount' && tip === null));

  const blocked = blockerMessage(tax, tip);
  $('results-blocked').textContent = blocked;
  if (blocked) {
    $('slips').replaceChildren();
    $('results-foot').hidden = true;
    return;
  }

  const result = computeSplit({ people: state.people, items: realItems(), taxCents: tax, tipCents: tip });
  const payer = state.people.find((p) => p.id === state.payerId);

  const slips = result.rows.map((row) => {
    const isPayer = payer && payer.id === row.id;
    const lines = row.lines.length
      ? row.lines.map((l) =>
          el('li', { class: 'slip-line' },
            el('span', {},
              l.name,
              l.sharedWith > 1 ? el('span', { class: 'shared', text: ` ÷${l.sharedWith}` }) : null
            ),
            el('span', { text: formatMoney(l.cents) })
          )
        )
      : [el('li', { class: 'slip-line' }, el('span', { class: 'shared', text: 'Nothing assigned' }), el('span', { text: '' }))];

    let owes = null;
    if (payer && !isPayer && row.total > 0) owes = `Pays ${payer.name} back ${formatMoney(row.total)}`;
    if (isPayer) owes = `Covered the bill. Gets back ${formatMoney(result.grandTotal - row.total)}`;

    return el('article', { class: 'slip', 'aria-label': `${row.name}'s share` },
      el('div', { class: 'slip-head' },
        el('span', { class: 'slip-name', text: row.name }),
        isPayer ? el('span', { class: 'slip-tag payer', text: 'Paid' }) : null
      ),
      el('ul', { class: 'slip-lines' }, ...lines),
      el('div', { class: 'slip-sums' },
        el('div', { class: 'slip-sum' }, el('span', { text: 'Food & drink' }), el('span', { text: formatMoney(row.subtotal) })),
        el('div', { class: 'slip-sum' }, el('span', { text: 'Tax' }), el('span', { text: formatMoney(row.tax) })),
        el('div', { class: 'slip-sum' }, el('span', { text: 'Tip' }), el('span', { text: formatMoney(row.tip) }))
      ),
      el('div', { class: 'slip-total' }, el('span', { text: 'Total' }), el('span', { text: formatMoney(row.total) })),
      owes ? el('p', { class: 'slip-owes', text: owes }) : null
    );
  });

  $('slips').replaceChildren(...slips);

  const foot = $('results-foot');
  let text = `Everyone together: ${formatMoney(result.grandTotal)} (${formatMoney(result.itemsTotal)} + ${formatMoney(tax)} tax + ${formatMoney(tip)} tip).`;
  const { totalCents } = state.receipt;
  if (totalCents !== null) {
    if (totalCents === result.grandTotal) text += ' Matches the total on the receipt.';
    else if (totalCents === result.itemsTotal + tax) text += ' Matches the receipt total plus your tip.';
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

/** Downscale huge phone photos, upscale tiny ones, and convert to grayscale. */
function prepareCanvas(source) {
  const w0 = source.width;
  const h0 = source.height;
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
  if (typeof source.close === 'function') source.close();
  return canvas;
}

const STATUS = {
  'loading tesseract core': 'Getting the reader ready…',
  'initializing tesseract': 'Getting the reader ready…',
  'loading language traineddata': 'Loading the English reader…',
  'initializing api': 'Getting the reader ready…',
  'recognizing text': 'Reading the receipt…',
};

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
  let canvas = null;
  try {
    const source = await decodeImage(file);
    canvas = prepareCanvas(source);

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
        if (m.status === 'recognizing text') $('busy-bar').value = Math.round((m.progress || 0) * 100);
      },
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    if (token !== state.scanToken) return; // user started over mid-scan

    const parsed = bestParse(data.text || '', textFromWords(wordsFromBlocks(data.blocks)));
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
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

function applyParsed(parsed, { append = false, noteEl = $('receipt-note') } = {}) {
  state.items = append ? state.items.filter((i) => !isBlank(i)) : [];
  const room = LIMITS.items - state.items.length;
  parsed.items.slice(0, Math.max(0, room)).forEach((i) => addItem(i.name, i.cents, false));

  if (append) {
    // Only fill in receipt figures the new text actually had.
    if (parsed.subtotalCents !== null) state.receipt.subtotalCents = parsed.subtotalCents;
    if (parsed.totalCents !== null) state.receipt.totalCents = parsed.totalCents;
    if (parsed.taxCents !== null && !$('tax').value.trim()) $('tax').value = centsToInput(parsed.taxCents);
    if (parsed.tipCents !== null && parsed.tipCents > 0 && !$('tip-amt').value.trim()) {
      $('tip-amt').value = centsToInput(parsed.tipCents);
      setTipMode('amount');
    }
  } else {
    state.receipt = { subtotalCents: parsed.subtotalCents, totalCents: parsed.totalCents };
    $('tax').value = parsed.taxCents !== null ? centsToInput(parsed.taxCents) : '';
    if (parsed.tipCents !== null && parsed.tipCents > 0) {
      $('tip-amt').value = centsToInput(parsed.tipCents);
      setTipMode('amount');
    }
  }

  const n = Math.min(parsed.items.length, Math.max(0, room));
  const note = noteEl;
  if (n === 0) {
    note.textContent = append
      ? 'No prices found in that text. Each item needs its price on the same line, like “Iced Tea 3.75”.'
      : 'No prices found in that photo. Try a sharper shot, or add the items by hand below.';
  } else {
    const bits = [`Found ${n} item${n === 1 ? '' : 's'}`];
    if (parsed.taxCents !== null) bits.push(`${formatMoney(parsed.taxCents)} tax`);
    if (parsed.tipCents !== null) bits.push(`${formatMoney(parsed.tipCents)} tip`);
    note.textContent = `${bits.join(', ')}. Check them against the ${append ? 'receipt' : 'photo'} before splitting.`;
  }

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
  $('tax').value = '';
  $('tip-amt').value = '';
  $('tip-pct').value = '20';
  $('person-name').value = '';
  $('receipt-note').textContent = '';
  $('paste-note').textContent = '';
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
$('tax').addEventListener('input', renderResults);
$('tax').addEventListener('blur', () => {
  const c = parseMoney($('tax').value);
  if (c !== null && c >= 0) $('tax').value = centsToInput(c);
});
$('tip-amt').addEventListener('input', renderResults);
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

renderPeople();
renderItems();
renderResults();
