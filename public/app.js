const WEEKDAYS = [
  { key: "man", label: "Mandag", short: "Man" },
  { key: "tir", label: "Tirsdag", short: "Tir" },
  { key: "ons", label: "Onsdag", short: "Ons" },
  { key: "tor", label: "Torsdag", short: "Tor" },
  { key: "fre", label: "Fredag", short: "Fre" },
];

const MIN_CLASSES = 1;
const MAX_CLASSES = 4;
/** Legacy fixed keys still accepted on import */
const LEGACY_CLASS_KEYS = ["maja", "ole"];

const COLORS = [
  { key: "red", label: "Rød" },
  { key: "orange", label: "Oransje" },
  { key: "yellow", label: "Gul" },
  { key: "green", label: "Grønn" },
  { key: "blue", label: "Blå" },
  { key: "purple", label: "Lilla" },
  { key: "pink", label: "Rosa" },
  { key: "brown", label: "Brun" },
  { key: "grey", label: "Grå" },
  { key: "white", label: "Hvit" },
];

const COLOR_KEYS = COLORS.map((c) => c.key);

/** localStorage on GitHub Pages (LogPad-style); Express API when `npm start`. */
const STORAGE_KEY = "timeplan-schedules-v8";
const LEGACY_STORAGE_KEYS = [
  "timeplan-schedules-v7",
  "timeplan-schedules-v6",
  "timeplan-schedules-v5",
];
const DATA_VERSION = 8;

/** @type {'api' | 'local' | null} */
let backend = null;

const els = {
  status: document.getElementById("status"),
  personTabs: document.getElementById("person-tabs"),
  dayTabs: document.getElementById("day-tabs"),
  viewActions: document.getElementById("view-actions"),
  editActions: document.getElementById("edit-actions"),
  btnEdit: document.getElementById("btn-edit"),
  btnCancel: document.getElementById("btn-cancel"),
  btnSave: document.getElementById("btn-save"),
  btnExport: document.getElementById("btn-export"),
  btnImport: document.getElementById("btn-import"),
  importInput: document.getElementById("import-input"),
  fileTools: document.getElementById("file-tools"),
  scheduleRoot: document.getElementById("schedule-root"),
  nameEdit: document.getElementById("name-edit"),
  nameInput: document.getElementById("name-input"),
  btnAddClass: document.getElementById("btn-add-class"),
  btnRemoveClass: document.getElementById("btn-remove-class"),
};

let schedules = null;
let draft = null;
let editing = false;
let saving = false;
let activePerson = "c1";
let activeDay = defaultDayKey();

function isClassRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasLegacySlotsGrid(person) {
  return (
    isClassRecord(person) &&
    Array.isArray(person.slots) &&
    person.grid &&
    typeof person.grid === "object"
  );
}

function hasPerDaySlots(person) {
  return isClassRecord(person) && person.days && typeof person.days === "object";
}

function isClassSchedule(person) {
  return hasPerDaySlots(person) || hasLegacySlotsGrid(person);
}

/** Ordered class keys for a schedule payload (1–4). */
function classKeys(data) {
  if (!data || typeof data !== "object") return [];
  let keys = [];
  if (Array.isArray(data.classes)) {
    keys = data.classes.filter(
      (k) => typeof k === "string" && isClassRecord(data[k])
    );
  }
  if (!keys.length) {
    keys = LEGACY_CLASS_KEYS.filter((k) => isClassRecord(data[k]));
  }
  if (!keys.length) {
    keys = Object.keys(data).filter((k) => isClassSchedule(data[k]));
  }
  return keys.slice(0, MAX_CLASSES);
}

function ensureActivePerson(data) {
  const keys = classKeys(data);
  if (!keys.length) return;
  if (!keys.includes(activePerson)) activePerson = keys[0];
}

function emptyDayBuckets() {
  const days = {};
  for (const day of WEEKDAYS) {
    days[day.key] = { slots: [] };
  }
  return days;
}

function blankClass(name) {
  return {
    name,
    title: name,
    days: emptyDayBuckets(),
  };
}

/**
 * Migrate shared slots+grid → independent per-day slot lists.
 * Each weekday gets its own copy so start/end/add/remove never clip other days.
 */
function migratePersonToDays(person) {
  if (!person || typeof person !== "object") return person;
  if (hasPerDaySlots(person) && !hasLegacySlotsGrid(person)) {
    ensureDayBuckets(person);
    return person;
  }

  const days = emptyDayBuckets();
  const sharedSlots = Array.isArray(person.slots) ? person.slots : [];
  const grid = person.grid && typeof person.grid === "object" ? person.grid : {};

  for (const day of WEEKDAYS) {
    const daySlotsList = [];
    for (const slot of sharedSlots) {
      // Manual pauses are dropped — gaps are derived at render time
      if (slot.type !== "lesson") continue;
      const baseId = slot.id || `s${daySlotsList.length}`;
      const cell = grid[slot.id]?.[day.key] || null;
      daySlotsList.push({
        id: `${baseId}-${day.key}`,
        n: slot.n,
        type: "lesson",
        start: slot.start,
        end: slot.end,
        label: slot.label,
        subject: cell?.subject ? String(cell.subject) : "",
        color: cell?.color || "white",
        room: cell?.room ? String(cell.room) : "",
      });
    }
    days[day.key] = { slots: daySlotsList };
  }

  person.days = days;
  delete person.slots;
  delete person.grid;
  return person;
}

function ensureDayBuckets(person) {
  if (!person.days || typeof person.days !== "object") {
    person.days = emptyDayBuckets();
  }
  for (const day of WEEKDAYS) {
    if (!person.days[day.key] || typeof person.days[day.key] !== "object") {
      person.days[day.key] = { slots: [] };
    }
    if (!Array.isArray(person.days[day.key].slots)) {
      person.days[day.key].slots = [];
    }
  }
}

/** Slots for one weekday only (independent list). */
function daySlots(person, dayKey = activeDay) {
  if (!person) return [];
  if (hasLegacySlotsGrid(person)) migratePersonToDays(person);
  ensureDayBuckets(person);
  return person.days[dayKey]?.slots || [];
}

/** Drop stored pause/lunsj rows — pauses are derived from lesson gaps. */
function stripNonLessonSlots(person) {
  if (!person) return;
  if (hasLegacySlotsGrid(person)) migratePersonToDays(person);
  ensureDayBuckets(person);
  for (const day of WEEKDAYS) {
    const slots = person.days[day.key].slots || [];
    person.days[day.key].slots = slots.filter((s) => s && s.type === "lesson");
  }
}

function stripAllNonLessonSlots(data) {
  if (!data) return;
  for (const key of classKeys(data)) {
    stripNonLessonSlots(data[key]);
  }
}

/**
 * Build render timeline for a day: lessons plus auto «Pause» rows for gaps
 * where lesson A ends before lesson B starts (both times non-midnight).
 */
function buildDayTimeline(person, dayKey, { namedOnly = false } = {}) {
  const slots = daySlots(person, dayKey);
  const lessons = [];
  slots.forEach((slot, index) => {
    if (!slot || slot.type !== "lesson") return;
    if (namedOnly && !String(slot.subject || "").trim()) return;
    lessons.push({ slot, index });
  });
  const out = [];
  for (let i = 0; i < lessons.length; i++) {
    if (i > 0) {
      const prev = lessons[i - 1].slot;
      const curr = lessons[i].slot;
      const prevEnd = timeToMinutes(prev.end);
      const currStart = timeToMinutes(curr.start);
      if (prevEnd > 0 && currStart > 0 && prevEnd < currStart) {
        out.push({
          kind: "pause",
          start: normalizeTime(prev.end),
          end: normalizeTime(curr.start),
        });
      }
    }
    out.push({ kind: "lesson", slot: lessons[i].slot, index: lessons[i].index });
  }
  return out;
}


function defaultDayKey(now = new Date()) {
  let jsDay = now.getDay();
  if (now.getHours() >= 15) jsDay = (jsDay + 1) % 7;
  if (jsDay === 0 || jsDay === 6) return "man";
  return WEEKDAYS[jsDay - 1].key;
}

let statusTimer = null;

function setStatus(message, kind = "") {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  els.status.textContent = message || "";
  els.status.classList.remove("is-ok", "is-err", "is-fading");
  if (kind) els.status.classList.add(kind);
  if (!message) return;
  // Transient feedback fades after 10s (keep loading text until cleared)
  const sticky = /henter|lagrer/i.test(message);
  if (sticky) return;
  statusTimer = setTimeout(() => {
    els.status.classList.add("is-fading");
    statusTimer = setTimeout(() => {
      els.status.textContent = "";
      els.status.classList.remove("is-ok", "is-err", "is-fading");
      statusTimer = null;
    }, 450);
  }, 10000);
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function colorClass(color) {
  const key = COLOR_KEYS.includes(color) ? color : "white";
  return `bg-${key}`;
}

function current() {
  return editing ? draft : schedules;
}

function dayMeta(key) {
  return WEEKDAYS.find((d) => d.key === key) || WEEKDAYS[0];
}

function displayName(person) {
  return person?.name || person?.title || "Klasse";
}

function splitTabLabel(name) {
  const m = String(name || "")
    .trim()
    .match(/^(.*?)(\s+)(\d+\s*[A-Za-zÆØÅæøå]?)$/);
  if (m) return { school: m[1].trim(), klass: m[3].trim() };
  return { school: "", klass: String(name || "").trim() };
}

const EMPTY_TIME = "00:00";

function normalizeTime(t) {
  const s = String(t || "").trim();
  return s || EMPTY_TIME;
}

/**
 * Minutes since midnight for sorting.
 * Empty / missing times are treated as 00:00 (midnight) — same as the UI default.
 */
function timeToMinutes(t) {
  const s = String(t ?? "").trim();
  if (!s) return 0;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(m[2] || "0", 10) || 0));
    return hh * 60 + mm;
  }
  const digits = s.replace(/\D/g, "");
  if (!digits) return 0;
  if (digits.length <= 2) {
    return Math.min(23, parseInt(digits, 10) || 0) * 60;
  }
  const hh = Math.min(23, parseInt(digits.slice(0, 2), 10) || 0);
  const mm = Math.min(59, parseInt(digits.slice(2, 4), 10) || 0);
  return hh * 60 + mm;
}

/**
 * Stable chronological order: start, then end, then prior index.
 * Start 00:00 (including empty → 00:00) sorts to the bottom of the day.
 */
function sortSlotsChronologically(slots) {
  if (!Array.isArray(slots) || slots.length < 2) return slots || [];
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const as = timeToMinutes(a.slot.start);
      const bs = timeToMinutes(b.slot.start);
      const aUnset = as === 0;
      const bUnset = bs === 0;
      if (aUnset !== bUnset) return aUnset ? 1 : -1;
      if (as !== bs) return as - bs;
      const ae = timeToMinutes(a.slot.end);
      const be = timeToMinutes(b.slot.end);
      if (ae !== be) return ae - be;
      return a.index - b.index;
    })
    .map(({ slot }) => slot);
}

function sortDaySlots(person, dayKey) {
  if (!person) return;
  const slots = daySlots(person, dayKey);
  person.days[dayKey].slots = sortSlotsChronologically(slots);
}

function sortPersonSlots(person) {
  if (!person) return;
  if (hasLegacySlotsGrid(person)) migratePersonToDays(person);
  ensureDayBuckets(person);
  for (const day of WEEKDAYS) {
    sortDaySlots(person, day.key);
  }
}

function sortAllClassSlots(data) {
  if (!data) return;
  for (const key of classKeys(data)) {
    sortPersonSlots(data[key]);
  }
}

function formatTime(t) {
  return normalizeTime(t).replace(":", ".");
}

/** Digits-only phone entry → TT:MM (e.g. 0815 → 08:15). Max 4 digits. */
function formatTimeInputValue(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 4);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function bindTimeInput(input, onChange) {
  input.addEventListener("input", () => {
    const formatted = formatTimeInputValue(input.value);
    if (input.value !== formatted) {
      input.value = formatted;
      // Keep caret at end while typing TTMM on phone
      try {
        const n = formatted.length;
        input.setSelectionRange(n, n);
      } catch {
        /* ignore */
      }
    }
    onChange(formatted);
  });
  input.addEventListener("blur", () => {
    if (String(input.value || "").trim()) return;
    input.value = EMPTY_TIME;
    onChange(EMPTY_TIME);
  });
}

function slotDisplayLabel(slot) {
  return `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
}

/** First lesson with subject → start; last with subject → end (this day only). */
function dayBounds(person, dayKey) {
  let start = "";
  let end = "";
  for (const slot of daySlots(person, dayKey)) {
    if (slot.type !== "lesson") continue;
    if (!String(slot.subject || "").trim()) continue;
    if (!start && slot.start) start = slot.start;
    if (slot.end) end = slot.end;
  }
  return { start, end };
}

function colorMap(data = current()) {
  return (data && data.subjectColors) || {};
}

function subjectColor(subject, fallback = "white") {
  if (!subject) return fallback;
  const map = colorMap();
  if (map[subject]) return map[subject];
  return COLOR_KEYS.includes(fallback) ? fallback : "white";
}

/** Apply color to a subject in ALL classes / days */
function applySubjectColor(subject, color) {
  if (!draft || !subject) return;
  if (!draft.subjectColors) draft.subjectColors = {};
  draft.subjectColors[subject] = color;
  for (const personKey of classKeys(draft)) {
    const person = draft[personKey];
    for (const day of WEEKDAYS) {
      for (const slot of daySlots(person, day.key)) {
        if (slot.type === "lesson" && slot.subject === subject) {
          slot.color = color;
        }
      }
    }
  }
}

function looksLikeSchedules(data) {
  if (!data || typeof data !== "object") return false;
  const keys = classKeys(data);
  if (keys.length < MIN_CLASSES) return false;
  return keys.every((k) => isClassSchedule(data[k]));
}

function emptySchedules() {
  return {
    version: DATA_VERSION,
    schoolYear: "",
    subjectColors: {},
    classes: ["c1", "c2"],
    c1: blankClass("Klasse 1"),
    c2: blankClass("Klasse 2"),
  };
}

function isScheduleEmpty(data) {
  if (!data) return true;
  for (const key of classKeys(data)) {
    const person = data[key];
    if (hasLegacySlotsGrid(person)) {
      for (const slot of person.slots || []) {
        if (slot.type !== "lesson") continue;
        const row = person.grid?.[slot.id];
        if (!row) continue;
        for (const day of WEEKDAYS) {
          if (row[day.key]?.subject) return false;
        }
      }
      continue;
    }
    for (const day of WEEKDAYS) {
      for (const slot of daySlots(person, day.key)) {
        if (slot.type === "lesson" && String(slot.subject || "").trim()) {
          return false;
        }
      }
    }
  }
  return true;
}

function stripTeachersFromData(data) {
  for (const key of classKeys(data)) {
    const person = data[key];
    if (hasLegacySlotsGrid(person)) {
      if (!person?.grid) continue;
      for (const row of Object.values(person.grid)) {
        if (!row || typeof row !== "object") continue;
        for (const day of Object.keys(row)) {
          const cell = row[day];
          if (!cell || typeof cell !== "object") continue;
          delete cell.teacher;
        }
      }
      continue;
    }
    for (const day of WEEKDAYS) {
      for (const slot of daySlots(person, day.key)) {
        delete slot.teacher;
      }
    }
  }
  return data;
}

function normalizeLoaded(raw) {
  if (!looksLikeSchedules(raw)) {
    throw new Error("Ugyldig timeplan-fil");
  }
  const data = clone(raw);
  data.version = DATA_VERSION;
  if (!data.subjectColors || typeof data.subjectColors !== "object") {
    data.subjectColors = {};
  }
  if (typeof data.schoolYear !== "string") {
    data.schoolYear = "";
  }

  let keys = classKeys(data);
  if (!keys.length) throw new Error("Ugyldig timeplan-fil");
  if (keys.length > MAX_CLASSES) keys = keys.slice(0, MAX_CLASSES);
  data.classes = keys;

  for (const key of [...Object.keys(data)]) {
    if (keys.includes(key)) continue;
    if (isClassSchedule(data[key])) {
      delete data[key];
    }
  }

  keys.forEach((key, i) => {
    migratePersonToDays(data[key]);
    ensureDayBuckets(data[key]);
    stripNonLessonSlots(data[key]);
    if (data[key]?.subjectColors) delete data[key].subjectColors;
    if (typeof data[key].name !== "string" || !data[key].name.trim()) {
      data[key].name = `Klasse ${i + 1}`;
    }
    data[key].title = data[key].name;
    // Drop any leftover shared structure
    delete data[key].slots;
    delete data[key].grid;
    sortPersonSlots(data[key]);
    for (const day of WEEKDAYS) {
      renumberDayLessons(data[key], day.key);
    }
  });
  stripTeachersFromData(data);
  return data;
}

function readLocal() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }
    if (!raw) return null;
    const data = normalizeLoaded(JSON.parse(raw));
    // Persist scrubbed v8 copy; drop legacy keys
    writeLocal(data);
    for (const key of LEGACY_STORAGE_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    return data;
  } catch {
    return null;
  }
}

function writeLocal(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

async function detectBackend() {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.ok && body?.service === "timeplan") {
        backend = "api";
        return backend;
      }
    }
  } catch {
    /* Pages / static host */
  }
  backend = "local";
  return backend;
}

async function loadFromApi() {
  const res = await fetch("/api/schedules", { cache: "no-store" });
  if (!res.ok) throw new Error("Kunne ikke hente timeplaner");
  return normalizeLoaded(await res.json());
}

async function loadFromLocal() {
  const stored = readLocal();
  if (stored) return stored;
  // New browser: blank schedule — no Haumyrheia seed. Import or Rediger to fill.
  return emptySchedules();
}

async function saveToApi(payload) {
  const res = await fetch("/api/schedules", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Lagring feilet");
  }
  return normalizeLoaded(await res.json());
}

async function saveToLocal(payload) {
  return writeLocal(normalizeLoaded(payload));
}

async function loadSchedules() {
  setStatus("Henter timeplaner…");
  await detectBackend();
  schedules =
    backend === "api" ? await loadFromApi() : await loadFromLocal();
  ensureActivePerson(schedules);
  setStatus("");
  render();
}

function exportSchedules() {
  const data = sanitize(current() || schedules);
  if (!data) {
    setStatus("Ingenting å eksportere", "is-err");
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `timeplan-${stamp}.json`;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  setStatus("Eksportert JSON-fil.", "is-ok");
}

function importSchedulesFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || ""));
      const next = normalizeLoaded(parsed);
      if (!backend) await detectBackend();
      schedules =
        backend === "api" ? await saveToApi(next) : await saveToLocal(next);
      ensureActivePerson(schedules);
      draft = editing ? clone(schedules) : null;
      if (draft) {
        draft.classes = classKeys(draft);
        ensureActivePerson(draft);
      }
      setStatus("Konfigurasjon lastet inn.", "is-ok");
      render();
    } catch (err) {
      setStatus(err.message || "Kunne ikke lese filen", "is-err");
    }
  };
  reader.onerror = () => setStatus("Kunne ikke lese filen", "is-err");
  reader.readAsText(file);
}

function setActivePerson(person) {
  const data = current();
  if (!data || !classKeys(data).includes(person)) return;
  activePerson = person;
  render();
}

function addClass() {
  if (!draft || !editing) return;
  const keys = classKeys(draft);
  if (keys.length >= MAX_CLASSES) {
    setStatus(`Maks ${MAX_CLASSES} klasser.`, "is-err");
    return;
  }
  const id = `c${Date.now().toString(36)}`;
  const name = `Klasse ${keys.length + 1}`;
  draft.classes = [...keys, id];
  draft[id] = blankClass(name);
  activePerson = id;
  setStatus(`La til ${name}.`, "is-ok");
  render();
}

function removeActiveClass() {
  if (!draft || !editing) return;
  const keys = classKeys(draft);
  if (keys.length <= MIN_CLASSES) {
    setStatus("Minst én klasse må være igjen.", "is-err");
    return;
  }
  if (!keys.includes(activePerson)) return;
  const removed = displayName(draft[activePerson]) || "Klassen";
  const nextKeys = keys.filter((k) => k !== activePerson);
  delete draft[activePerson];
  draft.classes = nextKeys;
  activePerson = nextKeys[0];
  setStatus(`Fjernet ${removed}.`, "is-ok");
  render();
}

function setActiveDay(dayKey) {
  if (!WEEKDAYS.some((d) => d.key === dayKey)) return;
  activeDay = dayKey;
  render();
}

function shiftActiveDay(delta) {
  const idx = WEEKDAYS.findIndex((d) => d.key === activeDay);
  if (idx < 0) return;
  const next = idx + delta;
  if (next < 0 || next >= WEEKDAYS.length) return;
  setActiveDay(WEEKDAYS[next].key);
}

/** Swipe left/right on the day view to change weekday (same as day chips). */
function initDaySwipe() {
  const target =
    document.querySelector(".schedule-section") || els.scheduleRoot;
  if (!target || target.dataset.daySwipeBound === "1") return;
  target.dataset.daySwipeBound = "1";

  let startX = 0;
  let startY = 0;
  let tracking = false;

  target.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest("input, select, textarea, button, a, label")) {
        tracking = false;
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    },
    { passive: true }
  );

  target.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 48) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.15) return;
      // Swipe left → next day; swipe right → previous day
      shiftActiveDay(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

function render() {
  const data = current();
  if (!data) return;
  ensureActivePerson(data);
  sortAllClassSlots(data);

  const person = data[activePerson];
  if (!person) return;
  const name = displayName(person);
  const keys = classKeys(data);

  renderPersonTabs(data);

  els.nameEdit.hidden = !editing;
  if (editing) els.nameInput.value = name;

  if (els.btnAddClass) {
    els.btnAddClass.disabled = saving || keys.length >= MAX_CLASSES;
    els.btnAddClass.setAttribute(
      "aria-disabled",
      String(keys.length >= MAX_CLASSES)
    );
  }
  if (els.btnRemoveClass) {
    els.btnRemoveClass.disabled = saving || keys.length <= MIN_CLASSES;
    els.btnRemoveClass.setAttribute(
      "aria-disabled",
      String(keys.length <= MIN_CLASSES)
    );
  }

  renderDayTabs(person);
  renderSingleDay(activePerson, person);

  document.body.classList.toggle("is-editing", editing);
  els.viewActions.hidden = editing;
  els.editActions.hidden = !editing;
  // Import/export in edit always; also in view when schedule is empty
  if (els.fileTools) {
    els.fileTools.hidden = !(editing || isScheduleEmpty(data));
  }
  els.btnSave.disabled = saving;
  els.btnCancel.disabled = saving;
  if (els.btnExport) els.btnExport.disabled = saving;
  if (els.btnImport) els.btnImport.disabled = saving;
}

function renderPersonTabs(data) {
  const root = els.personTabs;
  root.innerHTML = "";
  const keys = classKeys(data);
  root.style.gridTemplateColumns = `repeat(${Math.max(keys.length, 1)}, 1fr)`;
  root.dataset.count = String(keys.length);

  for (const key of keys) {
    const person = data[key];
    const name = displayName(person);
    const parts = splitTabLabel(name);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (key === activePerson ? " is-active" : "");
    btn.setAttribute("aria-selected", String(key === activePerson));
    btn.setAttribute("aria-label", name);
    if (parts.school) {
      btn.appendChild(el("span", "tab-school", parts.school));
      btn.appendChild(el("span", "tab-class", parts.klass));
    } else {
      btn.appendChild(el("span", "tab-class", parts.klass || name));
    }
    btn.addEventListener("click", () => setActivePerson(key));
    root.appendChild(btn);
  }
}

function renderDayTabs(person) {
  const root = els.dayTabs;
  root.innerHTML = "";

  for (const day of WEEKDAYS) {
    const bounds = dayBounds(person, day.key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tab" + (day.key === activeDay ? " is-active" : "");
    btn.setAttribute("aria-pressed", String(day.key === activeDay));
    btn.setAttribute("aria-label", day.label);
    btn.appendChild(el("span", "d", day.short));
    btn.appendChild(el("span", "t start", formatTime(bounds.start)));
    btn.appendChild(el("span", "t end", formatTime(bounds.end)));
    btn.addEventListener("click", () => setActiveDay(day.key));
    root.appendChild(btn);
  }
}

function renderSingleDay(personKey, personData) {
  const root = els.scheduleRoot;
  root.innerHTML = "";

  const day = dayMeta(activeDay);
  const card = document.createElement("article");
  card.className = "day-card";

  // Day from–to lives only on the weekday chips — not repeated in the card head
  const head = document.createElement("div");
  head.className = "day-card-head";
  head.appendChild(el("h3", null, day.label));
  card.appendChild(head);

  const list = document.createElement("div");
  list.className = "lesson-list";

  // View: only named lessons (+ auto pauses between them).
  // Edit: all lesson rows; auto pauses shown read-only between timed lessons.
  const timeline = buildDayTimeline(personData, day.key, {
    namedOnly: !editing,
  });

  for (const item of timeline) {
    if (item.kind === "pause") {
      list.appendChild(renderAutoPause(item.start, item.end));
      continue;
    }

    const slot = item.slot;
    const slotIndex = item.index;

    const row = document.createElement("div");
    row.className = "lesson";

    if (editing) {
      row.classList.add("lesson-edit");
      row.appendChild(renderTimeCell(personKey, slot, slotIndex));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-slot";
      remove.setAttribute("aria-label", "Fjern time");
      remove.textContent = "×";
      remove.addEventListener("click", () => removeSlot(personKey, slotIndex));
      row.appendChild(
        renderEditCell(personKey, slot, slotIndex, remove, row)
      );
    } else {
      row.appendChild(renderTimeCell(personKey, slot, slotIndex));
      row.appendChild(renderViewCell(slot));
    }
    list.appendChild(row);
  }

  if (editing) {
    const actions = document.createElement("div");
    actions.className = "add-slot-actions";

    const addLesson = document.createElement("button");
    addLesson.type = "button";
    addLesson.className = "add-lesson";
    addLesson.textContent = "Legg til time";
    addLesson.addEventListener("click", () => addLessonSlot(personKey));

    actions.append(addLesson);
    list.appendChild(actions);
  } else if (!list.children.length) {
    const empty = el(
      "p",
      "empty-schedule",
      "Ingen timeplan ennå. Trykk Importer for å hente en fil, eller Rediger for å lage en."
    );
    list.appendChild(empty);
  }

  card.appendChild(list);
  root.appendChild(card);
}

function renumberDayLessons(person, dayKey) {
  let n = 0;
  for (const slot of daySlots(person, dayKey)) {
    if (slot.type === "lesson") {
      n += 1;
      slot.n = n;
    }
  }
}

function renumberLessons(personKey, dayKey = activeDay) {
  if (!draft?.[personKey]) return;
  renumberDayLessons(draft[personKey], dayKey);
}

function removeSlot(personKey, slotIndex) {
  if (!draft) return;
  const person = draft[personKey];
  const slots = daySlots(person, activeDay);
  const target = slots[slotIndex];
  if (!target || target.type !== "lesson") return;
  slots.splice(slotIndex, 1);
  renumberLessons(personKey, activeDay);
  render();
}

function addLessonSlot(personKey) {
  if (!draft) return;
  const person = draft[personKey];
  stripNonLessonSlots(person);
  const slots = daySlots(person, activeDay);
  const lessonCount = slots.filter((s) => s.type === "lesson").length;
  const id = `x${Date.now().toString(36)}-${activeDay}`;
  slots.push({
    id,
    n: lessonCount + 1,
    type: "lesson",
    start: EMPTY_TIME,
    end: EMPTY_TIME,
    label: `${formatTime(EMPTY_TIME)} - ${formatTime(EMPTY_TIME)}`,
    subject: "",
    color: "white",
    room: "",
  });
  render();
}

/** Read-only auto pause from a lesson gap — always named «Pause». */
function renderAutoPause(start, end) {
  const br = document.createElement("div");
  br.className = "break-row break-view";
  const time = document.createElement("div");
  time.className = "lesson-time";
  time.appendChild(
    el("span", "lbl", `${formatTime(start)} - ${formatTime(end)}`)
  );
  const body = document.createElement("div");
  body.className = "break-body";
  body.textContent = "Pause";
  br.append(time, body);
  return br;
}

function renderTimeCell(personKey, slot, slotIndex) {
  const time = document.createElement("div");
  time.className = "lesson-time";

  if (editing) {
    const start = document.createElement("input");
    start.type = "text";
    start.inputMode = "numeric";
    start.autocomplete = "off";
    start.className = "time-input";
    start.placeholder = EMPTY_TIME;
    start.value = formatTimeInputValue(normalizeTime(slot.start));
    start.setAttribute("aria-label", "Starttid");
    bindTimeInput(start, (value) => {
      daySlots(draft[personKey], activeDay)[slotIndex].start = value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    start.addEventListener("blur", () => {
      sortDaySlots(draft[personKey], activeDay);
      renumberLessons(personKey, activeDay);
      render();
    });
    const end = document.createElement("input");
    end.type = "text";
    end.inputMode = "numeric";
    end.autocomplete = "off";
    end.className = "time-input";
    end.placeholder = EMPTY_TIME;
    end.value = formatTimeInputValue(normalizeTime(slot.end));
    end.setAttribute("aria-label", "Sluttid");
    bindTimeInput(end, (value) => {
      daySlots(draft[personKey], activeDay)[slotIndex].end = value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    end.addEventListener("blur", () => {
      sortDaySlots(draft[personKey], activeDay);
      renumberLessons(personKey, activeDay);
      render();
    });
    time.append(start, end);
  } else {
    time.appendChild(el("span", "lbl", slotDisplayLabel(slot)));
  }
  return time;
}

function syncSlotLabel(personKey, slotIndex) {
  const slot = daySlots(draft[personKey], activeDay)[slotIndex];
  // Pause/lunsj keep a name in label; only lesson rows sync label from times
  if (!slot || slot.type !== "lesson") return;
  slot.label = `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
}

function renderViewCell(slot) {
  const body = document.createElement("div");
  body.className = "lesson-body";

  const subject = String(slot?.subject || "").trim();
  if (!subject) {
    body.classList.add("empty");
    body.textContent = "Ingen time";
    return body;
  }

  const color = subjectColor(subject, slot.color);
  body.classList.add(colorClass(color));
  const line = document.createElement("div");
  line.className = "subject-line";
  line.appendChild(el("span", "subject", subject));
  const room = String(slot.room || "").trim();
  if (room) {
    line.appendChild(el("span", "room", room));
  }
  body.appendChild(line);
  return body;
}

function applyEditCellColor(body, colorKey) {
  for (const key of COLOR_KEYS) body.classList.remove(`bg-${key}`);
  body.classList.add(colorClass(colorKey));
}

function renderEditCell(person, slot, slotIndex, removeBtn, shell) {
  const body = document.createElement("div");
  body.className = "lesson-body edit-cell";
  const colorShell = shell || body;

  const getSlot = () => daySlots(draft[person], activeDay)[slotIndex];

  const subject = document.createElement("input");
  subject.className = "subject-input";
  subject.placeholder = "Fag";
  subject.value = slot?.subject || "";

  const color = document.createElement("select");
  color.className = "color-select";
  for (const c of COLORS) {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    color.appendChild(opt);
  }
  const initialSubject = slot?.subject || "";
  color.value = subjectColor(initialSubject, slot?.color || "white");
  applyEditCellColor(colorShell, color.value);

  const syncFieldColor = (colorKey) => {
    applyEditCellColor(colorShell, colorKey);
  };

  subject.addEventListener("input", () => {
    const s = getSlot();
    s.subject = subject.value.trim();
    if (s.subject) {
      const mapped = subjectColor(s.subject, s.color || "white");
      s.color = mapped;
      color.value = mapped;
      syncFieldColor(mapped);
    }
    renderDayTabs(draft[person]);
  });

  subject.addEventListener("change", () => {
    const s = getSlot();
    s.subject = subject.value.trim();
    if (s.subject) {
      const mapped = subjectColor(s.subject, color.value);
      s.color = mapped;
      applySubjectColor(s.subject, mapped);
      color.value = mapped;
      syncFieldColor(mapped);
    }
    renderDayTabs(draft[person]);
  });

  color.addEventListener("change", () => {
    const s = getSlot();
    s.color = color.value;
    syncFieldColor(color.value);
    const subj = (subject.value || s.subject || "").trim();
    if (subj) {
      s.subject = subj;
      applySubjectColor(subj, color.value);
      document.querySelectorAll(".lesson.lesson-edit").forEach((rowEl) => {
        if (rowEl.classList.contains("break-lesson")) return;
        const subInput = rowEl.querySelector(".subject-input");
        const sel = rowEl.querySelector(".color-select");
        if (subInput && sel && subInput.value.trim() === subj) {
          sel.value = color.value;
          applyEditCellColor(rowEl, color.value);
        }
      });
    }
  });

  const main = document.createElement("div");
  main.className = "edit-row-main has-room";

  const controls = document.createElement("div");
  controls.className = "edit-row-controls";

  const room = document.createElement("input");
  room.className = "room-input";
  room.placeholder = "Rom";
  room.value = slot?.room || "";
  room.addEventListener("input", () => {
    getSlot().room = room.value;
  });
  controls.append(room);

  controls.append(color);
  if (removeBtn) controls.append(removeBtn);

  main.append(subject, controls);
  body.append(main);

  return body;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function enterEdit() {
  if (!schedules) return;
  draft = clone(schedules);
  if (!draft.subjectColors) draft.subjectColors = {};
  draft.classes = classKeys(draft);
  for (const key of draft.classes) {
    delete draft[key].subjectColors;
    migratePersonToDays(draft[key]);
    stripNonLessonSlots(draft[key]);
  }
  ensureActivePerson(draft);
  editing = true;
  setStatus("Redigeringsmodus — husk å lagre.");
  render();
}

function cancelEdit() {
  draft = null;
  editing = false;
  setStatus("Endringer forkastet.");
  render();
}

function sanitize(data) {
  const out = clone(data);
  if (!out.subjectColors) out.subjectColors = {};
  let keys = classKeys(out);
  if (keys.length < MIN_CLASSES) {
    out.classes = ["c1"];
    out.c1 = out.c1 || blankClass("Klasse 1");
    keys = ["c1"];
  }
  if (keys.length > MAX_CLASSES) keys = keys.slice(0, MAX_CLASSES);
  out.classes = keys;
  out.version = DATA_VERSION;

  for (const key of [...Object.keys(out)]) {
    if (keys.includes(key)) continue;
    if (isClassSchedule(out[key])) {
      delete out[key];
    }
  }

  for (const person of keys) {
    const name = String(out[person].name || "").trim() || out[person].title;
    out[person].name = name;
    out[person].title = name;
    delete out[person].subjectColors;
    migratePersonToDays(out[person]);
    ensureDayBuckets(out[person]);
    delete out[person].slots;
    delete out[person].grid;

    stripNonLessonSlots(out[person]);
    for (const day of WEEKDAYS) {
      const slots = out[person].days[day.key].slots.filter(
        (s) => s && s.type === "lesson"
      );
      for (const slot of slots) {
        slot.type = "lesson";
        slot.start = normalizeTime(slot.start);
        slot.end = normalizeTime(slot.end);
        slot.label = `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
        const subject = String(slot.subject || "").trim();
        const room = String(slot.room || "").trim();
        slot.subject = subject;
        if (room) slot.room = room;
        else delete slot.room;
        let color = slot.color || "white";
        if (subject && out.subjectColors[subject]) {
          color = out.subjectColors[subject];
        } else if (subject && color && color !== "white") {
          out.subjectColors[subject] = color;
        }
        slot.color = color;
        delete slot.teacher;
      }
      out[person].days[day.key].slots = sortSlotsChronologically(slots);
      renumberDayLessons(out[person], day.key);
    }
  }

  for (const person of keys) {
    for (const day of WEEKDAYS) {
      for (const slot of daySlots(out[person], day.key)) {
        if (
          slot.type === "lesson" &&
          slot.subject &&
          out.subjectColors[slot.subject]
        ) {
          slot.color = out.subjectColors[slot.subject];
        }
      }
    }
  }
  return out;
}

async function saveEdit() {
  if (!draft || saving) return;
  if (els.nameInput?.value.trim()) {
    draft[activePerson].name = els.nameInput.value.trim();
    draft[activePerson].title = draft[activePerson].name;
  }
  saving = true;
  setStatus("Lagrer…");
  render();
  try {
    if (!backend) await detectBackend();
    const payload = sanitize(draft);
    schedules =
      backend === "api"
        ? await saveToApi(payload)
        : await saveToLocal(payload);
    draft = null;
    editing = false;
    setStatus(
      backend === "api" ? "Lagret på serveren." : "Lagret i nettleseren.",
      "is-ok"
    );
  } catch (err) {
    setStatus(err.message || "Kunne ikke lagre", "is-err");
  } finally {
    saving = false;
    render();
  }
}

els.nameInput.addEventListener("input", () => {
  if (!draft) return;
  const value = els.nameInput.value;
  draft[activePerson].name = value;
  draft[activePerson].title = value;
  renderPersonTabs(draft);
});

els.btnEdit.addEventListener("click", enterEdit);
els.btnCancel.addEventListener("click", cancelEdit);
els.btnSave.addEventListener("click", saveEdit);
els.btnExport?.addEventListener("click", exportSchedules);
els.btnImport?.addEventListener("click", () => els.importInput?.click());
els.importInput?.addEventListener("change", () => {
  const file = els.importInput.files?.[0];
  els.importInput.value = "";
  if (file) importSchedulesFile(file);
});
els.btnAddClass?.addEventListener("click", addClass);
els.btnRemoveClass?.addEventListener("click", removeActiveClass);

initDaySwipe();

loadSchedules().catch((err) => {
  setStatus(err.message || "Noe gikk galt", "is-err");
});
