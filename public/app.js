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

const els = {
  status: document.getElementById("status"),
  personTabs: document.getElementById("person-tabs"),
  dayTabs: document.getElementById("day-tabs"),
  viewActions: document.getElementById("view-actions"),
  editActions: document.getElementById("edit-actions"),
  btnEdit: document.getElementById("btn-edit"),
  btnCancel: document.getElementById("btn-cancel"),
  btnSave: document.getElementById("btn-save"),
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

function setStatus(message, kind = "") {
  els.status.textContent = message || "";
  els.status.classList.remove("is-ok", "is-err");
  if (kind) els.status.classList.add(kind);
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

function subjectColor(person, subject, fallback = "white") {
  if (!subject) return fallback;
  const map = person.subjectColors || {};
  if (map[subject]) return map[subject];
  return COLOR_KEYS.includes(fallback) ? fallback : "white";
}

function applySubjectColor(personKey, subject, color) {
  if (!draft || !subject) return;
  const person = draft[personKey];
  if (!person.subjectColors) person.subjectColors = {};
  person.subjectColors[subject] = color;
  for (const slot of person.slots || []) {
    const row = person.grid?.[slot.id];
    if (!row) continue;
    for (const day of WEEKDAYS) {
      const cell = row[day.key];
      if (cell?.subject === subject) cell.color = color;
    }
  }
}

async function loadSchedules() {
  setStatus("Henter timeplaner…");
  const res = await fetch("/api/schedules", { cache: "no-store" });
  if (!res.ok) throw new Error("Kunne ikke hente timeplaner");
  schedules = await res.json();
  setStatus("");
  render();
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
  els.btnSave.disabled = saving;
  els.btnCancel.disabled = saving;
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
  const bounds = dayBounds(personData, day.key);
  const card = document.createElement("article");
  card.className = "day-card";

  const head = document.createElement("div");
  head.className = "day-card-head";
  head.appendChild(el("h3", null, day.label));
  const range = document.createElement("span");
  range.className = "ends";
  if (bounds.start || bounds.end) {
    range.textContent = `${formatTime(bounds.start) || "?"} – ${formatTime(bounds.end) || "?"}`;
  } else {
    range.textContent = "Ingen timer";
  }
  head.appendChild(range);
  card.appendChild(head);

  const list = document.createElement("div");
  list.className = "lesson-list";

  (personData.slots || []).forEach((slot, slotIndex) => {
    if (slot.type !== "lesson") {
      list.appendChild(renderBreakRow(personKey, slot, slotIndex));
      return;
    }

    const cellData = personData.grid?.[slot.id]?.[day.key] ?? null;
    const row = document.createElement("div");
    row.className = "lesson";

    row.appendChild(renderTimeCell(personKey, slot, slotIndex));

    if (editing) {
      row.appendChild(renderEditCell(personKey, slot, day.key, cellData));
    } else {
      row.appendChild(renderViewCell(personData, cellData));
    }
    list.appendChild(row);
  });

  card.appendChild(list);
  root.appendChild(card);
}

function renderBreakRow(personKey, slot, slotIndex) {
  const br = document.createElement("div");
  br.className = "break-row";
  if (editing) {
    br.classList.add("break-edit");
    const kind = el(
      "span",
      "break-kind",
      slot.type === "lunsj" ? "Lunsj" : slot.type === "pause" ? "Pause" : "Pause"
    );
    const start = document.createElement("input");
    start.type = "text";
    start.inputMode = "numeric";
    start.placeholder = "Start";
    start.value = slot.start || "";
    start.addEventListener("input", () => {
      draft[personKey].slots[slotIndex].start = start.value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    const end = document.createElement("input");
    end.type = "text";
    end.inputMode = "numeric";
    end.placeholder = "Slutt";
    end.value = slot.end || "";
    end.addEventListener("input", () => {
      draft[personKey].slots[slotIndex].end = end.value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    br.append(kind, start, end);
  } else {
    const kind =
      slot.type === "lunsj" ? "Lunsj" : slot.type === "pause" ? "Pause" : slot.label;
    br.textContent = slot.start && slot.end
      ? `${kind} · ${slotDisplayLabel(slot)}`
      : kind;
  }
  return br;
}

function renderTimeCell(personKey, slot, slotIndex) {
  const time = document.createElement("div");
  time.className = "lesson-time";
  if (slot.n) time.appendChild(el("span", "n", String(slot.n)));

  if (editing) {
    const start = document.createElement("input");
    start.type = "text";
    start.inputMode = "numeric";
    start.className = "time-input";
    start.placeholder = "08:15";
    start.value = slot.start || "";
    start.setAttribute("aria-label", "Starttid");
    start.addEventListener("input", () => {
      draft[personKey].slots[slotIndex].start = start.value;
      syncSlotLabel(personKey, slotIndex);
      renderDayTabs(draft[personKey]);
    });
    const end = document.createElement("input");
    end.type = "text";
    end.inputMode = "numeric";
    end.className = "time-input";
    end.placeholder = "09:15";
    end.value = slot.end || "";
    end.setAttribute("aria-label", "Sluttid");
    end.addEventListener("input", () => {
      draft[personKey].slots[slotIndex].end = end.value;
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

  const color = subjectColor(personData, cellData.subject, cellData.color);
  body.classList.add(colorClass(color));
  body.appendChild(el("span", "subject", cellData.subject));
  if (cellData.room || cellData.teacher) {
    const parts = [];
    if (cellData.room) parts.push(`Rom: ${cellData.room}`);
    if (cellData.teacher) parts.push(cellData.teacher);
    body.appendChild(el("span", "meta", parts.join(" · ")));
  }
  return body;
}

function renderEditCell(person, slot, dayKey, cellData) {
  const body = document.createElement("div");
  body.className = "lesson-body edit-cell";

  const ensure = () => {
    if (!draft[person].grid[slot.id]) draft[person].grid[slot.id] = {};
    if (!draft[person].grid[slot.id][dayKey]) {
      draft[person].grid[slot.id][dayKey] = {
        subject: "",
        color: "white",
        room: "",
        teacher: "",
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
  color.value = subjectColor(
    draft[person],
    initialSubject,
    cellData?.color || "white"
  );

  subject.addEventListener("input", () => {
    const cell = ensure();
    const prev = cell.subject;
    cell.subject = subject.value.trim();
    if (cell.subject) {
      const mapped = subjectColor(draft[person], cell.subject, cell.color || "white");
      cell.color = mapped;
      color.value = mapped;
    }
    // If renaming away from old subject, day bounds update
    renderDayTabs(draft[person]);
  });

  subject.addEventListener("change", () => {
    const cell = ensure();
    cell.subject = subject.value.trim();
    if (cell.subject) {
      const mapped = subjectColor(draft[person], cell.subject, color.value);
      cell.color = mapped;
      applySubjectColor(person, cell.subject, mapped);
      color.value = mapped;
    }
    renderDayTabs(draft[person]);
  });

  color.addEventListener("change", () => {
    const cell = ensure();
    cell.color = color.value;
    const subj = (subject.value || cell.subject || "").trim();
    if (subj) {
      cell.subject = subj;
      applySubjectColor(person, subj, color.value);
      // Keep other open color selects for same subject in sync
      document.querySelectorAll(".lesson-body.edit-cell").forEach((wrap) => {
        const subInput = wrap.querySelector(".subject-input");
        const sel = wrap.querySelector(".color-select");
        if (subInput && sel && subInput.value.trim() === subj) {
          sel.value = color.value;
        }
      });
    }
  });

  body.append(subject, color);

  if (person === "ole") {
    const room = document.createElement("input");
    room.placeholder = "Rom";
    room.value = cellData?.room || "";
    room.addEventListener("input", () => {
      ensure().room = room.value;
    });
    const teacher = document.createElement("input");
    teacher.placeholder = "Lærer";
    teacher.value = cellData?.teacher || "";
    teacher.addEventListener("input", () => {
      ensure().teacher = teacher.value;
    });
    body.append(room, teacher);
  }

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
  for (const key of PEOPLE) {
    if (!draft[key].subjectColors) draft[key].subjectColors = {};
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
  for (const person of PEOPLE) {
    const name = String(out[person].name || "").trim() || out[person].title;
    out[person].name = name;
    out[person].title = name;
    if (!out[person].subjectColors) out[person].subjectColors = {};

    for (const slot of out[person].slots) {
      slot.start = String(slot.start || "").trim();
      slot.end = String(slot.end || "").trim();
      if (slot.start && slot.end) {
        slot.label = `${formatTime(slot.start)} - ${formatTime(slot.end)}`;
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
        const teacher = String(cell.teacher || "").trim();
        if (!subject && !room && !teacher) {
          row[day.key] = null;
        } else {
          let color = cell.color || "white";
          if (subject && out[person].subjectColors[subject]) {
            color = out[person].subjectColors[subject];
          } else if (subject && color && color !== "white") {
            out[person].subjectColors[subject] = color;
          }
          row[day.key] = { subject, color };
          if (room) row[day.key].room = room;
          if (teacher) row[day.key].teacher = teacher;
        }
      }
      out[person].grid[slot.id] = row;
    }

    // Final sync: all cells of a subject share color
    for (const slot of out[person].slots) {
      for (const day of WEEKDAYS) {
        const cell = out[person].grid[slot.id]?.[day.key];
        if (cell?.subject && out[person].subjectColors[cell.subject]) {
          cell.color = out[person].subjectColors[cell.subject];
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
    const payload = sanitize(draft);
    const res = await fetch("/api/schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Lagring feilet");
    }
    schedules = await res.json();
    draft = null;
    editing = false;
    setStatus("Lagret på serveren.", "is-ok");
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

loadSchedules().catch((err) => {
  setStatus(err.message || "Noe gikk galt", "is-err");
});
