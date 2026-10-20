const WEEKDAYS = [
  { key: "man", label: "Mandag", short: "Man" },
  { key: "tir", label: "Tirsdag", short: "Tir" },
  { key: "ons", label: "Onsdag", short: "Ons" },
  { key: "tor", label: "Torsdag", short: "Tor" },
  { key: "fre", label: "Fredag", short: "Fre" },
];

const PEOPLE = ["ole", "maja"]; // 8A, 10A

const COLORS = [
  "green",
  "lightGreen",
  "brown",
  "yellow",
  "purple",
  "darkPurple",
  "peach",
  "paleYellow",
  "blue",
  "lightBlue",
  "cyan",
  "magenta",
  "orange",
  "pink",
  "greyBlue",
  "grey",
  "darkGrey",
  "red",
  "white",
];

const els = {
  status: document.getElementById("status"),
  schoolYear: document.getElementById("school-year"),
  personTabs: document.getElementById("person-tabs"),
  dayTabs: document.getElementById("day-tabs"),
  viewActions: document.getElementById("view-actions"),
  editActions: document.getElementById("edit-actions"),
  btnEdit: document.getElementById("btn-edit"),
  btnCancel: document.getElementById("btn-cancel"),
  btnSave: document.getElementById("btn-save"),
  scheduleTitle: document.getElementById("schedule-title"),
  scheduleSub: document.getElementById("schedule-sub"),
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

/** Current school day, or next day after 15:00. Weekend → Monday. */
function defaultDayKey(now = new Date()) {
  let jsDay = now.getDay();
  const hour = now.getHours();
  if (hour >= 15) jsDay = (jsDay + 1) % 7;
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
  const key = COLORS.includes(color) ? color : "white";
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
  // "Haumyrheia 8A" → school + class for compact tabs
  const m = String(name || "").trim().match(/^(.*?)(\s+)(\d+\s*[A-Za-zÆØÅæøå]?)$/);
  if (m) {
    return { school: m[1].trim(), klass: m[3].trim() };
  }
  return { school: "", klass: String(name || "").trim() };
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

  els.schoolYear.textContent = data.schoolYear || "2026/2027";
  const person = data[activePerson];
  const name = displayName(person);

  renderPersonTabs(data);
  els.scheduleTitle.textContent = name;
  els.scheduleSub.textContent =
    activePerson === "ole" ? "Fag, rom og lærer" : "Fag med farger";

  els.nameEdit.hidden = !editing;
  if (editing) {
    els.nameInput.value = name;
  }

  renderDayTabs(data.dayEnds?.[activePerson] || {});
  renderSingleDay(activePerson, person, data.dayEnds?.[activePerson] || {});

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
    btn.dataset.person = key;
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

function renderDayTabs(ends) {
  const root = els.dayTabs;
  root.innerHTML = "";

  for (const day of WEEKDAYS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tab" + (day.key === activeDay ? " is-active" : "");
    btn.setAttribute("aria-pressed", String(day.key === activeDay));
    btn.setAttribute("aria-label", day.label);
    btn.appendChild(el("span", "d", day.short));

    const endVal = ends[day.key] || "";
    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.className = "day-end-input";
      input.value = endVal;
      input.setAttribute("aria-label", `${activePerson} ${day.label} slutt`);
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("input", () => {
        draft.dayEnds[activePerson][day.key] = input.value;
      });
      btn.appendChild(input);
    } else {
      btn.appendChild(el("span", "t", endVal || "—"));
    }

    btn.addEventListener("click", () => setActiveDay(day.key));
    root.appendChild(btn);
  }
}

function renderSingleDay(personKey, personData, dayEnds) {
  const root = els.scheduleRoot;
  root.innerHTML = "";

  const day = dayMeta(activeDay);
  const card = document.createElement("article");
  card.className = "day-card";

  const head = document.createElement("div");
  head.className = "day-card-head";
  head.appendChild(el("h3", null, day.label));
  const end = dayEnds[day.key];
  if (end) head.appendChild(el("span", "ends", `Slutt ${end}`));
  card.appendChild(head);

  const list = document.createElement("div");
  list.className = "lesson-list";

  for (const slot of personData.slots || []) {
    if (slot.type !== "lesson") {
      const br = document.createElement("div");
      br.className = "break-row";
      br.textContent =
        slot.type === "lunsj"
          ? `Lunsj · ${slot.label}`
          : slot.type === "pause"
            ? `Pause · ${slot.label}`
            : slot.label;
      list.appendChild(br);
      continue;
    }

    const cellData = personData.grid?.[slot.id]?.[day.key] ?? null;
    const row = document.createElement("div");
    row.className = "lesson";

    const time = document.createElement("div");
    time.className = "lesson-time";
    if (slot.n) time.appendChild(el("span", "n", String(slot.n)));
    time.appendChild(el("span", "lbl", slot.label));
    row.appendChild(time);

    if (editing) {
      row.appendChild(renderEditCell(personKey, slot, day.key, cellData));
    } else {
      row.appendChild(renderViewCell(cellData));
    }
    list.appendChild(row);
  }

  card.appendChild(list);
  root.appendChild(card);
}

function renderViewCell(cellData) {
  const body = document.createElement("div");
  body.className = "lesson-body";

  if (!cellData || !cellData.subject) {
    body.classList.add("empty");
    body.textContent = "Ingen time";
    return body;
  }

  body.classList.add(colorClass(cellData.color));
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
  subject.addEventListener("input", () => {
    ensure().subject = subject.value;
  });

  const color = document.createElement("select");
  for (const c of COLORS) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if ((cellData?.color || "white") === c) opt.selected = true;
    color.appendChild(opt);
  }
  color.addEventListener("change", () => {
    ensure().color = color.value;
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

function applyNameFromInput() {
  if (!draft || !els.nameInput) return;
  const value = els.nameInput.value.trim();
  if (!value) return;
  draft[activePerson].name = value;
  draft[activePerson].title = value;
}

function sanitize(data) {
  const out = clone(data);
  for (const person of PEOPLE) {
    const name = String(out[person].name || "").trim() || out[person].title;
    out[person].name = name;
    out[person].title = name;
    for (const slot of out[person].slots) {
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
          row[day.key] = { subject, color: cell.color || "white" };
          if (room) row[day.key].room = room;
          if (teacher) row[day.key].teacher = teacher;
        }
      }
      out[person].grid[slot.id] = row;
    }
  }
  return out;
}

async function saveEdit() {
  if (!draft || saving) return;
  applyNameFromInput();
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
  // live-update title + tabs while typing
  els.scheduleTitle.textContent = value || "Klasse";
  renderPersonTabs(draft);
});

els.btnEdit.addEventListener("click", enterEdit);
els.btnCancel.addEventListener("click", cancelEdit);
els.btnSave.addEventListener("click", saveEdit);

loadSchedules().catch((err) => {
  setStatus(err.message || "Noe gikk galt", "is-err");
});
