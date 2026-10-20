const WEEKDAYS = [
  { key: "man", label: "Mandag", short: "Man" },
  { key: "tir", label: "Tirsdag", short: "Tir" },
  { key: "ons", label: "Onsdag", short: "Ons" },
  { key: "tor", label: "Torsdag", short: "Tor" },
  { key: "fre", label: "Fredag", short: "Fre" },
];

const PEOPLE = ["ole", "maja"];

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
const STORAGE_KEY = "timeplan-schedules-v6";
const LEGACY_STORAGE_KEYS = ["timeplan-schedules-v5"];
const DATA_VERSION = 6;

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
};

let schedules = null;
let draft = null;
let editing = false;
let saving = false;
let activePerson = "ole";
let activeDay = defaultDayKey();

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

function formatTime(t) {
  return String(t || "").replace(":", ".");
}

/** Digits-only phone entry → TT:MM (e.g. 0815 → 08:15). Max 4 digits. */
function formatTimeInputValue(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 4);
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
}

function slotDisplayLabel(slot) {
  if (slot.start && slot.end) {
    return `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
  }
  return slot.label || "";
}

/** First lesson with subject → start; last with subject → end */
function dayBounds(person, dayKey) {
  let start = "";
  let end = "";
  for (const slot of person.slots || []) {
    if (slot.type !== "lesson") continue;
    const cell = person.grid?.[slot.id]?.[dayKey];
    if (!cell?.subject) continue;
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

/** Apply color to a subject in BOTH classes */
function applySubjectColor(subject, color) {
  if (!draft || !subject) return;
  if (!draft.subjectColors) draft.subjectColors = {};
  draft.subjectColors[subject] = color;
  for (const personKey of PEOPLE) {
    const person = draft[personKey];
    for (const slot of person.slots || []) {
      const row = person.grid?.[slot.id];
      if (!row) continue;
      for (const day of WEEKDAYS) {
        const cell = row[day.key];
        if (cell?.subject === subject) cell.color = color;
      }
    }
  }
}

function looksLikeSchedules(data) {
  return Boolean(
    data &&
      data.maja &&
      data.ole &&
      Array.isArray(data.maja.slots) &&
      Array.isArray(data.ole.slots) &&
      data.maja.grid &&
      data.ole.grid
  );
}

function emptySchedules() {
  return {
    version: DATA_VERSION,
    schoolYear: "",
    subjectColors: {},
    maja: { name: "Klasse 1", title: "Klasse 1", slots: [], grid: {} },
    ole: { name: "Klasse 2", title: "Klasse 2", slots: [], grid: {} },
  };
}

function isScheduleEmpty(data) {
  if (!data) return true;
  for (const key of PEOPLE) {
    for (const slot of data[key]?.slots || []) {
      if (slot.type !== "lesson") continue;
      const row = data[key].grid?.[slot.id];
      if (!row) continue;
      for (const day of WEEKDAYS) {
        if (row[day.key]?.subject) return false;
      }
    }
  }
  return true;
}

function stripTeachersFromData(data) {
  for (const key of PEOPLE) {
    const person = data[key];
    if (!person?.grid) continue;
    for (const row of Object.values(person.grid)) {
      if (!row || typeof row !== "object") continue;
      for (const day of Object.keys(row)) {
        const cell = row[day];
        if (!cell || typeof cell !== "object") continue;
        delete cell.teacher;
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
  for (const key of PEOPLE) {
    if (!data[key].grid || typeof data[key].grid !== "object") {
      data[key].grid = {};
    }
    if (!Array.isArray(data[key].slots)) data[key].slots = [];
    if (data[key]?.subjectColors) delete data[key].subjectColors;
    if (typeof data[key].name !== "string" || !data[key].name.trim()) {
      data[key].name = key === "ole" ? "Klasse 2" : "Klasse 1";
    }
    data[key].title = data[key].name;
  }
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
    // Persist scrubbed v6 copy; drop legacy keys
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
      draft = editing ? clone(schedules) : null;
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
  if (!PEOPLE.includes(person)) return;
  activePerson = person;
  render();
}

function setActiveDay(dayKey) {
  if (!WEEKDAYS.some((d) => d.key === dayKey)) return;
  activeDay = dayKey;
  render();
}

function render() {
  const data = current();
  if (!data) return;

  const person = data[activePerson];
  const name = displayName(person);

  renderPersonTabs(data);

  els.nameEdit.hidden = !editing;
  if (editing) els.nameInput.value = name;

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

  for (const key of PEOPLE) {
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
    btn.appendChild(el("span", "t start", formatTime(bounds.start) || "—"));
    btn.appendChild(el("span", "t end", formatTime(bounds.end) || "—"));
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

  (personData.slots || []).forEach((slot, slotIndex) => {
    if (slot.type !== "lesson") {
      // I visning: hopp over pause/lunsj som ikke ligger mellom synlige timer
      if (!editing && !breakTouchesNamedLesson(personData, day.key, slotIndex)) {
        return;
      }
      list.appendChild(renderBreakRow(personKey, slot, slotIndex));
      return;
    }

    const cellData = personData.grid?.[slot.id]?.[day.key] ?? null;
    // Vis ikke timer uten fagnavn (unntatt i redigering)
    if (!editing && !(cellData && cellData.subject)) {
      return;
    }

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
        renderEditCell(personKey, slot, day.key, cellData, remove, row)
      );
    } else {
      row.appendChild(renderTimeCell(personKey, slot, slotIndex));
      row.appendChild(renderViewCell(personData, cellData));
    }
    list.appendChild(row);
  });

  if (editing) {
    const actions = document.createElement("div");
    actions.className = "add-slot-actions";

    const addLesson = document.createElement("button");
    addLesson.type = "button";
    addLesson.className = "add-lesson";
    addLesson.textContent = "Legg til time";
    addLesson.addEventListener("click", () => addLessonSlot(personKey));

    const addPause = document.createElement("button");
    addPause.type = "button";
    addPause.className = "add-lesson add-pause";
    addPause.textContent = "Legg til pause";
    addPause.addEventListener("click", () => addPauseSlot(personKey));

    // Time above pause
    actions.append(addLesson, addPause);
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

function hasNamedLesson(person, dayKey, slot) {
  if (!slot || slot.type !== "lesson") return false;
  const cell = person.grid?.[slot.id]?.[dayKey];
  return !!(cell && cell.subject);
}

/** Vis pause bare mellom navngitte timer — ikke først eller sist på dagen */
function breakTouchesNamedLesson(person, dayKey, breakIndex) {
  const slots = person.slots || [];
  let before = false;
  let after = false;
  for (let i = breakIndex - 1; i >= 0; i--) {
    if (slots[i].type === "lesson") {
      before = hasNamedLesson(person, dayKey, slots[i]);
      break;
    }
  }
  for (let i = breakIndex + 1; i < slots.length; i++) {
    if (slots[i].type === "lesson") {
      after = hasNamedLesson(person, dayKey, slots[i]);
      break;
    }
  }
  return before && after;
}

function renumberLessons(personKey) {
  let n = 0;
  for (const slot of draft[personKey].slots) {
    if (slot.type === "lesson") {
      n += 1;
      slot.n = n;
    }
  }
}

function removeSlot(personKey, slotIndex) {
  if (!draft) return;
  const person = draft[personKey];
  const [removed] = person.slots.splice(slotIndex, 1);
  if (removed?.id && person.grid) {
    delete person.grid[removed.id];
  }
  renumberLessons(personKey);
  render();
}

function addLessonSlot(personKey) {
  if (!draft) return;
  const person = draft[personKey];
  const lessonCount = person.slots.filter((s) => s.type === "lesson").length;
  const id = `x${Date.now().toString(36)}`;
  person.slots.push({
    id,
    n: lessonCount + 1,
    type: "lesson",
    start: "",
    end: "",
    label: "",
  });
  person.grid[id] = {
    man: null,
    tir: null,
    ons: null,
    tor: null,
    fre: null,
  };
  render();
}

function addPauseSlot(personKey) {
  if (!draft) return;
  const person = draft[personKey];
  const id = `p${Date.now().toString(36)}`;
  person.slots.push({
    id,
    type: "pause",
    start: "",
    end: "",
    label: "Pause",
  });
  render();
}

function pauseDisplayName(slot) {
  const label = String(slot?.label || "").trim();
  if (label) return label;
  if (slot?.type === "lunsj") return "Lunsj";
  if (slot?.type === "pause") return "Pause";
  return "Pause";
}

function renderBreakRow(personKey, slot, slotIndex) {
  if (editing) {
    // Same shell as lessons: striped field covers times + name/× (no Rom)
    const row = document.createElement("div");
    row.className = "lesson break-lesson lesson-edit";

    row.appendChild(renderTimeCell(personKey, slot, slotIndex));

    const body = document.createElement("div");
    body.className = "lesson-body edit-cell break-edit-cell";

    const main = document.createElement("div");
    main.className = "edit-row-main";

    const name = document.createElement("input");
    name.className = "subject-input pause-name-input";
    name.placeholder = "Pause";
    const rawLabel = String(slot?.label || "").trim();
    // Default «Pause» stays as gray placeholder, not filled text
    name.value =
      !rawLabel || rawLabel.toLowerCase() === "pause" ? "" : rawLabel;
    name.setAttribute("aria-label", "Pausenavn");
    name.addEventListener("input", () => {
      const value = name.value.trim();
      draft[personKey].slots[slotIndex].label = value || "Pause";
      const lower = value.toLowerCase();
      draft[personKey].slots[slotIndex].type =
        lower === "lunsj" ? "lunsj" : "pause";
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-slot";
    remove.setAttribute("aria-label", "Fjern pause");
    remove.textContent = "×";
    remove.addEventListener("click", () => removeSlot(personKey, slotIndex));

    const controls = document.createElement("div");
    controls.className = "edit-row-controls break-edit-controls";
    controls.append(remove);

    main.append(name, controls);
    body.append(main);
    row.appendChild(body);
    return row;
  }

  const br = document.createElement("div");
  br.className = "break-row break-view";
  const time = document.createElement("div");
  time.className = "lesson-time";
  time.appendChild(el("span", "lbl", slotDisplayLabel(slot) || "—"));
  const body = document.createElement("div");
  body.className = "break-body";
  body.textContent = pauseDisplayName(slot);
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
    start.placeholder = "08:15";
    start.value = formatTimeInputValue(slot.start || "");
    start.setAttribute("aria-label", "Starttid");
    bindTimeInput(start, (value) => {
      draft[personKey].slots[slotIndex].start = value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    const end = document.createElement("input");
    end.type = "text";
    end.inputMode = "numeric";
    end.autocomplete = "off";
    end.className = "time-input";
    end.placeholder = "09:15";
    end.value = formatTimeInputValue(slot.end || "");
    end.setAttribute("aria-label", "Sluttid");
    bindTimeInput(end, (value) => {
      draft[personKey].slots[slotIndex].end = value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    time.append(start, end);
  } else {
    time.appendChild(el("span", "lbl", slotDisplayLabel(slot)));
  }
  return time;
}

function syncSlotLabel(personKey, slotIndex) {
  const slot = draft[personKey].slots[slotIndex];
  // Pause/lunsj keep a name in label; only lesson rows sync label from times
  if (slot.type !== "lesson") return;
  if (slot.start && slot.end) {
    slot.label = `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
  }
}

function renderViewCell(personData, cellData) {
  const body = document.createElement("div");
  body.className = "lesson-body";

  if (!cellData || !cellData.subject) {
    body.classList.add("empty");
    body.textContent = "Ingen time";
    return body;
  }

  const color = subjectColor(cellData.subject, cellData.color);
  body.classList.add(colorClass(color));
  const line = document.createElement("div");
  line.className = "subject-line";
  line.appendChild(el("span", "subject", cellData.subject));
  const room = String(cellData.room || "").trim();
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

function renderEditCell(person, slot, dayKey, cellData, removeBtn, shell) {
  const body = document.createElement("div");
  body.className = "lesson-body edit-cell";
  const colorShell = shell || body;

  const ensure = () => {
    if (!draft[person].grid[slot.id]) draft[person].grid[slot.id] = {};
    if (!draft[person].grid[slot.id][dayKey]) {
      draft[person].grid[slot.id][dayKey] = {
        subject: "",
        color: "white",
        room: "",
      };
    }
    return draft[person].grid[slot.id][dayKey];
  };

  const subject = document.createElement("input");
  subject.className = "subject-input";
  subject.placeholder = "Fag";
  subject.value = cellData?.subject || "";

  const color = document.createElement("select");
  color.className = "color-select";
  for (const c of COLORS) {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    color.appendChild(opt);
  }
  const initialSubject = cellData?.subject || "";
  color.value = subjectColor(initialSubject, cellData?.color || "white");
  applyEditCellColor(colorShell, color.value);

  const syncFieldColor = (colorKey) => {
    applyEditCellColor(colorShell, colorKey);
  };

  subject.addEventListener("input", () => {
    const cell = ensure();
    cell.subject = subject.value.trim();
    if (cell.subject) {
      const mapped = subjectColor(cell.subject, cell.color || "white");
      cell.color = mapped;
      color.value = mapped;
      syncFieldColor(mapped);
    }
    renderDayTabs(draft[person]);
  });

  subject.addEventListener("change", () => {
    const cell = ensure();
    cell.subject = subject.value.trim();
    if (cell.subject) {
      const mapped = subjectColor(cell.subject, color.value);
      cell.color = mapped;
      applySubjectColor(cell.subject, mapped);
      color.value = mapped;
      syncFieldColor(mapped);
    }
    renderDayTabs(draft[person]);
  });

  color.addEventListener("change", () => {
    const cell = ensure();
    cell.color = color.value;
    syncFieldColor(color.value);
    const subj = (subject.value || cell.subject || "").trim();
    if (subj) {
      cell.subject = subj;
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
  main.className = "edit-row-main";
  if (person === "ole") main.classList.add("has-room");

  const controls = document.createElement("div");
  controls.className = "edit-row-controls";

  if (person === "ole") {
    const room = document.createElement("input");
    room.className = "room-input";
    room.placeholder = "Rom";
    room.value = cellData?.room || "";
    room.addEventListener("input", () => {
      ensure().room = room.value;
    });
    controls.append(room);
  }

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
  for (const key of PEOPLE) {
    delete draft[key].subjectColors;
  }
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

  for (const person of PEOPLE) {
    const name = String(out[person].name || "").trim() || out[person].title;
    out[person].name = name;
    out[person].title = name;
    delete out[person].subjectColors;

    for (const slot of out[person].slots) {
      slot.start = String(slot.start || "").trim();
      slot.end = String(slot.end || "").trim();
      if (slot.type === "lesson" && slot.start && slot.end) {
        slot.label = `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
      } else if (slot.type !== "lesson") {
        const name = String(slot.label || "").trim();
        // Recover if an older sanitize overwrote pause names with times
        if (!name || /^\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}$/.test(name)) {
          slot.label = slot.type === "lunsj" ? "Lunsj" : "Pause";
        } else {
          slot.label = name;
        }
      }
      const row = out[person].grid[slot.id] || {};
      for (const day of WEEKDAYS) {
        const cell = row[day.key];
        if (!cell) {
          row[day.key] = null;
          continue;
        }
        const subject = String(cell.subject || "").trim();
        const room = String(cell.room || "").trim();
        if (!subject && !room) {
          row[day.key] = null;
        } else {
          let color = cell.color || "white";
          if (subject && out.subjectColors[subject]) {
            color = out.subjectColors[subject];
          } else if (subject && color && color !== "white") {
            out.subjectColors[subject] = color;
          }
          row[day.key] = { subject, color };
          if (room) row[day.key].room = room;
        }
      }
      out[person].grid[slot.id] = row;
    }
  }

  // Final sync across both classes
  for (const person of PEOPLE) {
    for (const slot of out[person].slots) {
      for (const day of WEEKDAYS) {
        const cell = out[person].grid[slot.id]?.[day.key];
        if (cell?.subject && out.subjectColors[cell.subject]) {
          cell.color = out.subjectColors[cell.subject];
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

loadSchedules().catch((err) => {
  setStatus(err.message || "Noe gikk galt", "is-err");
});
