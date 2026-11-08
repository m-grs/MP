'use strict';

const STORAGE_KEY = 'mp_state_v1';

// Abwechslung: Gewicht eines Gerichts je nachdem, wie viele Mahlzeiten seit dem letzten Mal vergangen sind.
// Index 0 = letzte Mahlzeit (kommt nur dran, wenn nichts anderes da ist), 1 = vorletzte, 2 = vorvorletzte.
const VARIETY = [0, 0.4, 0.7];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_FULL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MAX_PORTIONS = 40;

const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}
function dishKey(name) {
  return cleanName(name).toLocaleLowerCase('de-DE');
}

/* ================= DATUM ================= */
function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return fmtDate(new Date()); }
function parseDate(s) { return new Date(s + 'T00:00:00'); }
function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
function daysSince(dateStr) {
  return Math.max(0, Math.round((parseDate(todayStr()) - parseDate(dateStr)) / 86400000));
}
function ageText(dateStr) {
  const n = daysSince(dateStr);
  return n === 0 ? 'heute' : n === 1 ? 'gestern' : `vor ${n} Tagen`;
}
// "So 02.11." – mit Jahr, wenn es nicht das aktuelle ist
function dayDate(dateStr) {
  const d = parseDate(dateStr);
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  const year = d.getFullYear() !== new Date().getFullYear() ? String(d.getFullYear()).slice(2) : '';
  return `${WD[d.getDay()]} ${dm}${year}`;
}
function portionsText(n) { return n === 1 ? '1 Portion' : `${n} Portionen`; }

/* ================= STATE ================= */
// batches: ein Eintrag je Kochen {id, dish, date, portions, removed, created}
// meals:   ein Eintrag je gegessener Portion {id, batchId, at}
let state = loadState();

function normalizeState(s) {
  if (!s || typeof s !== 'object') s = {};
  s.batches = Array.isArray(s.batches) ? s.batches : [];
  s.batches = s.batches.filter(b => b && typeof b === 'object'
    && cleanName(b.dish) && typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date));
  const seen = new Set();
  s.batches.forEach(b => {
    if (typeof b.id !== 'string' || !b.id || seen.has(b.id)) b.id = uid();
    seen.add(b.id);
    b.dish = cleanName(b.dish);
    b.portions = Math.min(MAX_PORTIONS * 5, Math.max(1, Math.round(Number(b.portions) || 1)));
    b.removed = Math.max(0, Math.round(Number(b.removed) || 0));
    b.created = Number(b.created) || 0;
  });
  s.meals = Array.isArray(s.meals) ? s.meals : [];
  s.meals = s.meals.filter(m => m && typeof m === 'object' && seen.has(m.batchId)
    && typeof m.at === 'string' && !isNaN(Date.parse(m.at)));
  s.meals.forEach(m => { if (typeof m.id !== 'string' || !m.id) m.id = uid(); });
  // Bestand darf nie negativ werden
  const counts = new Map();
  s.meals.forEach(m => counts.set(m.batchId, (counts.get(m.batchId) || 0) + 1));
  s.batches.forEach(b => {
    const eaten = counts.get(b.id) || 0;
    if (eaten > b.portions) b.portions = eaten;
    if (eaten + b.removed > b.portions) b.removed = b.portions - eaten;
  });
  return s;
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) { /* beschädigte Daten ignorieren */ }
  return normalizeState({});
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ================= AUSWERTUNG DER DATEN ================= */
function mealCounts() {
  const m = new Map();
  state.meals.forEach(x => m.set(x.batchId, (m.get(x.batchId) || 0) + 1));
  return m;
}
function restOf(b, counts) {
  return Math.max(0, b.portions - (counts.get(b.id) || 0) - b.removed);
}
function byAge(a, b) {
  return a.date.localeCompare(b.date) || a.created - b.created;
}

// alle je gekochten Gerichte mit Statistik
function catalog() {
  const counts = mealCounts();
  const map = new Map();
  state.batches.forEach(b => {
    const k = dishKey(b.dish);
    if (!map.has(k)) map.set(k, { key: k, name: b.dish, batches: [], cooked: 0, portions: 0, eaten: 0, rest: 0, last: '', lastPortions: b.portions, lastCreated: -1 });
    const d = map.get(k);
    d.batches.push(b);
    d.cooked++;
    d.portions += b.portions;
    d.eaten += counts.get(b.id) || 0;
    d.rest += restOf(b, counts);
    if (b.date > d.last || (b.date === d.last && b.created > d.lastCreated)) {
      d.last = b.date; d.lastCreated = b.created; d.lastPortions = b.portions; d.name = b.dish;
    }
  });
  const list = [...map.values()];
  list.forEach(d => d.batches.sort(byAge).reverse());
  return list;
}

// Gerichte mit Restportionen; gegessen wird immer zuerst aus dem ältesten Kochen
function stockList() {
  const counts = mealCounts();
  const map = new Map();
  state.batches.forEach(b => {
    const rest = restOf(b, counts);
    if (rest <= 0) return;
    const k = dishKey(b.dish);
    if (!map.has(k)) map.set(k, { key: k, name: b.dish, rest: 0, open: [] });
    const d = map.get(k);
    d.rest += rest;
    d.open.push(b);
  });
  const list = [...map.values()];
  list.forEach(d => { d.open.sort(byAge); d.oldest = d.open[0].date; });
  return list;
}

// Vorschlagsreihenfolge: Priorität = Alter in Tagen (+1) × Abwechslungs-Gewicht
function rankedStock() {
  const list = stockList();
  const batchById = new Map(state.batches.map(b => [b.id, b]));
  // jüngste Mahlzeit zuerst; bei gleicher Uhrzeit zählt die Reihenfolge des Eintragens
  const recent = state.meals
    .map((m, i) => ({ m, i }))
    .sort((a, b) => b.m.at.localeCompare(a.m.at) || b.i - a.i)
    .slice(0, VARIETY.length)
    .map(x => dishKey(batchById.get(x.m.batchId).dish));
  list.forEach(d => {
    const k = recent.indexOf(d.key);
    d.score = (daysSince(d.oldest) + 1) * (k >= 0 ? VARIETY[k] : 1);
  });
  return list.sort((a, b) => b.score - a.score
    || a.oldest.localeCompare(b.oldest)
    || b.rest - a.rest
    || a.name.localeCompare(b.name, 'de'));
}

/* ================= TAB-NAVIGATION ================= */
document.querySelectorAll('.navbtn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.getElementById('main').scrollTop = 0;
  if (name === 'essen') { suggestOffset = 0; renderEssen(); }
  if (name === 'kochen') renderDishChips();
  if (name === 'katalog') renderKatalog();
}

/* ================= TOAST ================= */
const toastEl = document.getElementById('toast');
const toastText = document.getElementById('toast-text');
const toastUndoBtn = document.getElementById('toast-undo');
let toastTimer = null;
let toastUndo = null;

function showToast(text, undo) {
  toastText.textContent = text;
  toastUndo = undo || null;
  toastUndoBtn.hidden = !undo;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 5000 : 1500);
}
function hideToast() {
  toastEl.classList.remove('show');
  toastUndo = null;
}
toastUndoBtn.addEventListener('click', () => {
  const undo = toastUndo;
  hideToast();
  if (undo) undo();
});

/* ================= ESSEN ================= */
const suggestCard = document.getElementById('suggest-card');
const stockListEl = document.getElementById('stock-list');
const stockTotalEl = document.getElementById('stock-total');
let suggestOffset = 0;
let currentSuggestion = null;

function renderEssen() {
  const ranked = rankedStock();

  if (!ranked.length) {
    currentSuggestion = null;
    suggestCard.innerHTML = `<h3>Vorschlag</h3>
      <p class="empty">Kein Vorrat.</p>
      <button type="button" class="btn primary" id="btn-goto-kochen">Gekocht eintragen</button>`;
    document.getElementById('btn-goto-kochen').addEventListener('click', () => switchTab('kochen'));
  } else {
    const idx = suggestOffset % ranked.length;
    const d = ranked[idx];
    currentSuggestion = d.key;
    suggestCard.innerHTML = `<h3>Vorschlag${ranked.length > 1 ? ` <span class="dim">${idx + 1} von ${ranked.length}</span>` : ''}</h3>
      <div class="suggest-dish">${escapeHtml(d.name)}</div>
      <div class="suggest-meta">gekocht ${dayDate(d.oldest)} · ${ageText(d.oldest)} · noch ${portionsText(d.rest)}</div>
      <div class="btn-row">
        <button type="button" class="btn primary" id="btn-eat">Gegessen</button>
        ${ranked.length > 1 ? '<button type="button" class="btn" id="btn-next">Anderer Vorschlag</button>' : ''}
      </div>`;
    document.getElementById('btn-eat').addEventListener('click', () => eatDish(d.key));
    const next = document.getElementById('btn-next');
    if (next) next.addEventListener('click', () => { suggestOffset++; renderEssen(); });
  }

  // Vorrat: älteste zuerst
  const stock = [...ranked].sort((a, b) => a.oldest.localeCompare(b.oldest) || a.name.localeCompare(b.name, 'de'));
  const total = stock.reduce((s, d) => s + d.rest, 0);
  stockTotalEl.textContent = total ? portionsText(total) : '';
  document.getElementById('stock-card').hidden = !stock.length;
  stockListEl.innerHTML = stock.map(d => `
    <button type="button" class="stock-row" data-key="${escapeHtml(d.key)}">
      <div>
        <div class="stock-name">${escapeHtml(d.name)}</div>
        <div class="stock-meta">gekocht ${dayDate(d.oldest)} · ${ageText(d.oldest)}</div>
      </div>
      <div class="count-badge">${d.rest}</div>
    </button>`).join('');
}
stockListEl.addEventListener('click', (e) => {
  const row = e.target.closest('.stock-row');
  if (row) openDishModal(row.dataset.key);
});

function eatDish(key) {
  const d = stockList().find(x => x.key === key);
  if (!d) return;
  const batch = d.open[0];
  const meal = { id: uid(), batchId: batch.id, at: new Date().toISOString() };
  state.meals.push(meal);
  saveState();
  suggestOffset = 0;
  renderEssen();
  showToast(`${batch.dish} gegessen`, () => {
    state.meals = state.meals.filter(m => m.id !== meal.id);
    saveState();
    renderEssen();
    renderKatalog();
  });
}

/* ---------- Gericht im Vorrat: Restportionen korrigieren ---------- */
const dishModal = document.getElementById('dish-modal');
const dishModalBatches = document.getElementById('dish-modal-batches');
const dishModalEat = document.getElementById('dish-modal-eat');
let modalKey = null;
let modalBatchIds = [];

function openDishModal(key) {
  const d = stockList().find(x => x.key === key);
  if (!d) return;
  modalKey = key;
  modalBatchIds = d.open.map(b => b.id);
  document.getElementById('dish-modal-title').textContent = d.name;
  renderDishModal();
  dishModal.hidden = false;
}
function closeDishModal() {
  dishModal.hidden = true;
  modalKey = null;
  modalBatchIds = [];
}
function renderDishModal() {
  const counts = mealCounts();
  const batches = modalBatchIds.map(id => state.batches.find(b => b.id === id)).filter(Boolean);
  dishModalBatches.innerHTML = batches.map(b => {
    const rest = restOf(b, counts);
    const eaten = counts.get(b.id) || 0;
    return `<div class="sheet-row">
      <div>
        <div class="batch-date">gekocht ${dayDate(b.date)}</div>
        <div class="batch-meta">${ageText(b.date)} · ${portionsText(b.portions)}, ${eaten} gegessen</div>
      </div>
      <div class="stepper">
        <button type="button" data-adj="-1" data-id="${b.id}" aria-label="Eine weniger"${rest <= 0 ? ' disabled' : ''}>−</button>
        <span class="val">${rest}</span>
        <button type="button" data-adj="1" data-id="${b.id}" aria-label="Eine mehr"${rest >= MAX_PORTIONS ? ' disabled' : ''}>+</button>
      </div>
    </div>`;
  }).join('');
  dishModalEat.disabled = !batches.some(b => restOf(b, counts) > 0);
}
dishModalBatches.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-adj]');
  if (!btn) return;
  const b = state.batches.find(x => x.id === btn.dataset.id);
  if (!b) return;
  const rest = restOf(b, mealCounts());
  if (btn.dataset.adj === '-1') {
    if (rest <= 0) return;
    b.removed++;
  } else {
    if (rest >= MAX_PORTIONS) return;
    if (b.removed > 0) b.removed--;
    else b.portions++;
  }
  saveState();
  renderDishModal();
  renderEssen();
});
dishModalEat.addEventListener('click', () => {
  const key = modalKey;
  closeDishModal();
  eatDish(key);
});
document.getElementById('dish-modal-close').addEventListener('click', closeDishModal);
dishModal.addEventListener('click', (e) => { if (e.target === dishModal) closeDishModal(); });

/* ================= KOCHEN ================= */
const dishInput = document.getElementById('dish-input');
const dishChips = document.getElementById('dish-chips');
const portionsValue = document.getElementById('portions-value');
const portionsMinus = document.getElementById('portions-minus');
const portionsPlus = document.getElementById('portions-plus');
const cookDateInput = document.getElementById('cook-date');
const DEFAULT_PORTIONS = 4;
let cookPortions = DEFAULT_PORTIONS;
let cookDateMode = 'today';

function renderDishChips() {
  const q = dishKey(dishInput.value);
  let dishes = catalog().sort((a, b) => b.cooked - a.cooked || b.last.localeCompare(a.last) || a.name.localeCompare(b.name, 'de'));
  dishes = q ? dishes.filter(d => d.key.includes(q)) : dishes.slice(0, 16);
  dishChips.innerHTML = dishes.map(d =>
    `<button type="button" class="chip${d.key === q ? ' active' : ''}" data-key="${escapeHtml(d.key)}">${escapeHtml(d.name)}</button>`
  ).join('');
}
dishChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const d = catalog().find(x => x.key === chip.dataset.key);
  if (!d) return;
  dishInput.value = d.name;
  dishInput.classList.remove('invalid');
  setPortions(d.lastPortions);
  renderDishChips();
});
dishInput.addEventListener('input', () => {
  dishInput.classList.remove('invalid');
  renderDishChips();
});
dishInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dishInput.blur();
});

function setPortions(n) {
  cookPortions = Math.min(MAX_PORTIONS, Math.max(1, n));
  portionsValue.textContent = cookPortions;
  portionsMinus.disabled = cookPortions <= 1;
  portionsPlus.disabled = cookPortions >= MAX_PORTIONS;
}
portionsMinus.addEventListener('click', () => setPortions(cookPortions - 1));
portionsPlus.addEventListener('click', () => setPortions(cookPortions + 1));

function setCookDateMode(mode) {
  cookDateMode = mode;
  document.querySelectorAll('#cook-date-switch .dbtn').forEach(b => b.classList.toggle('active', b.dataset.d === mode));
  cookDateInput.hidden = mode !== 'other';
  if (mode === 'other') {
    cookDateInput.max = todayStr();
    if (!cookDateInput.value) cookDateInput.value = addDays(todayStr(), -2);
  }
}
document.getElementById('cook-date-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('.dbtn');
  if (btn) setCookDateMode(btn.dataset.d);
});

function selectedCookDate() {
  if (cookDateMode === 'yesterday') return addDays(todayStr(), -1);
  if (cookDateMode === 'other' && /^\d{4}-\d{2}-\d{2}$/.test(cookDateInput.value)) {
    return cookDateInput.value > todayStr() ? todayStr() : cookDateInput.value;
  }
  return todayStr();
}

function resetCookForm() {
  dishInput.value = '';
  dishInput.classList.remove('invalid');
  cookDateInput.value = '';
  setPortions(DEFAULT_PORTIONS);
  setCookDateMode('today');
  renderDishChips();
}

document.getElementById('btn-cook').addEventListener('click', () => {
  let name = cleanName(dishInput.value);
  if (!name) {
    dishInput.classList.add('invalid');
    dishInput.focus();
    return;
  }
  // gleiche Schreibweise wie beim bekannten Gericht verwenden ("chili" -> "Chili")
  const known = catalog().find(d => d.key === dishKey(name));
  if (known) name = known.name;
  const batch = { id: uid(), dish: name, date: selectedCookDate(), portions: cookPortions, removed: 0, created: Date.now() };
  state.batches.push(batch);
  saveState();
  resetCookForm();
  renderEssen();
  showToast(`${name} eingetragen`, () => {
    state.batches = state.batches.filter(b => b.id !== batch.id);
    state.meals = state.meals.filter(m => m.batchId !== batch.id);
    saveState();
    renderAll();
  });
});

/* ================= KATALOG ================= */
const katalogList = document.getElementById('katalog-list');
const katalogSummary = document.getElementById('katalog-summary');
let katalogSort = 'last';
const openDishes = new Set();

function renderKatalog() {
  const counts = mealCounts();
  const dishes = catalog();
  if (katalogSort === 'count') dishes.sort((a, b) => b.cooked - a.cooked || b.portions - a.portions || a.name.localeCompare(b.name, 'de'));
  else if (katalogSort === 'name') dishes.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  else dishes.sort((a, b) => b.last.localeCompare(a.last) || b.lastCreated - a.lastCreated);

  if (!dishes.length) {
    katalogSummary.textContent = '';
    katalogList.innerHTML = '<p class="empty">Noch nichts gekocht.</p>';
    return;
  }
  const cooked = dishes.reduce((s, d) => s + d.cooked, 0);
  const portions = dishes.reduce((s, d) => s + d.portions, 0);
  katalogSummary.textContent = `${dishes.length} ${dishes.length === 1 ? 'Gericht' : 'Gerichte'} · ${cooked}× gekocht · ${portionsText(portions)}`;

  katalogList.innerHTML = dishes.map(d => `
    <div class="dish${openDishes.has(d.key) ? ' open' : ''}">
      <button type="button" class="dish-head" data-toggle="${escapeHtml(d.key)}">
        <div>
          <div class="dish-name">${escapeHtml(d.name)}</div>
          <div class="dish-meta">${d.cooked}× gekocht · ${portionsText(d.portions)}${d.rest ? ` · noch ${d.rest}` : ''}</div>
        </div>
        <div class="dish-last">${dayDate(d.last)}</div>
      </button>
      <div class="dish-body">
        ${d.batches.map(b => {
          const eaten = counts.get(b.id) || 0;
          const rest = restOf(b, counts);
          return `<div class="batch-row">
            <div>
              <div class="batch-date">${dayDate(b.date)}</div>
              <div class="batch-meta">${portionsText(b.portions)} · ${eaten} gegessen${rest ? ` · noch ${rest}` : ''}</div>
            </div>
            <button type="button" class="icon-btn" data-del="${b.id}" aria-label="Löschen">${ICON_TRASH}</button>
          </div>`;
        }).join('')}
        <button type="button" class="btn" data-rename="${escapeHtml(d.key)}">Umbenennen</button>
      </div>
    </div>`).join('');
}

katalogList.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const key = toggle.dataset.toggle;
    if (openDishes.has(key)) openDishes.delete(key); else openDishes.add(key);
    toggle.parentElement.classList.toggle('open', openDishes.has(key));
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) { deleteBatch(del.dataset.del); return; }
  const ren = e.target.closest('[data-rename]');
  if (ren) renameDish(ren.dataset.rename);
});

function deleteBatch(id) {
  const b = state.batches.find(x => x.id === id);
  if (!b) return;
  if (!confirm(`${b.dish} vom ${dayDate(b.date)} (${portionsText(b.portions)}) löschen?`)) return;
  state.batches = state.batches.filter(x => x.id !== id);
  state.meals = state.meals.filter(m => m.batchId !== id);
  saveState();
  renderAll();
}

function renameDish(key) {
  const d = catalog().find(x => x.key === key);
  if (!d) return;
  const input = prompt('Neuer Name', d.name);
  if (input == null) return;
  const name = cleanName(input);
  if (!name || name === d.name) return;
  const newKey = dishKey(name);
  if (newKey !== key && catalog().some(x => x.key === newKey)) {
    if (!confirm(`„${name}“ gibt es schon. Beide zusammenführen?`)) return;
  }
  state.batches.forEach(b => {
    const k = dishKey(b.dish);
    if (k === key || k === newKey) b.dish = name;
  });
  openDishes.delete(key);
  openDishes.add(newKey);
  saveState();
  renderAll();
}

document.getElementById('sort-switch').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-s]');
  if (!btn) return;
  katalogSort = btn.dataset.s;
  document.querySelectorAll('#sort-switch button').forEach(b => b.classList.toggle('active', b === btn));
  renderKatalog();
});

/* ================= EINSTELLUNGEN ================= */
function download(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('btn-export').addEventListener('click', () => {
  download(JSON.stringify(state, null, 2), 'application/json', `mealprep-backup-${todayStr()}.json`);
});

function toCsvField(value) {
  const s = value == null ? '' : String(value);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function buildCsv() {
  const counts = mealCounts();
  const header = ['Datum', 'Wochentag', 'Gericht', 'Portionen', 'Gegessen', 'Entfernt', 'Übrig'];
  const rows = [...state.batches].sort(byAge).map(b => [
    b.date,
    WD_FULL[parseDate(b.date).getDay()],
    b.dish,
    b.portions,
    counts.get(b.id) || 0,
    b.removed,
    restOf(b, counts),
  ]);
  return '﻿' + [header, ...rows].map(r => r.map(toCsvField).join(';')).join('\r\n');
}
document.getElementById('btn-export-csv').addEventListener('click', () => {
  download(buildCsv(), 'text/csv;charset=utf-8', `mealprep-export-${todayStr()}.csv`);
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || typeof imported !== 'object' || !Array.isArray(imported.batches)) throw new Error('invalid');
      if (confirm('Backup importieren? Vorhandene Daten werden überschrieben.')) {
        state = normalizeState(imported);
        saveState();
        renderAll();
        switchTab('katalog');
      }
    } catch (err) {
      alert('Diese Datei konnte nicht gelesen werden.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

document.getElementById('btn-wipe').addEventListener('click', () => {
  if (confirm('Wirklich ALLE Daten unwiderruflich löschen?')) {
    if (confirm('Bist du sicher? Dies kann nicht rückgängig gemacht werden.')) {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      openDishes.clear();
      renderAll();
      switchTab('essen');
    }
  }
});

/* ================= START ================= */
function renderAll() {
  renderEssen();
  renderDishChips();
  renderKatalog();
}

setPortions(DEFAULT_PORTIONS);
renderAll();

// beim Zurückkehren in die App (z. B. am nächsten Tag) Alter und Vorschlag neu berechnen
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  state = loadState();
  suggestOffset = 0;
  renderAll();
  if (modalKey) renderDishModal();
});

// bittet iOS/Browser, den lokalen Speicher nicht automatisch zu räumen
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
