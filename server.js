const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3847;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "schedules.json");
const SEED_FILE = path.join(DATA_DIR, "seed.json");
const WEEKDAYS = ["man", "tir", "ons", "tor", "fre"];
const PEOPLE = ["maja", "ole"];
const DATA_VERSION = 5;
const BASIC_COLORS = new Set([
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "grey",
  "white",
]);

function loadSeed() {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
}

function withMeta(seed) {
  return {
    version: DATA_VERSION,
    schoolYear: seed.schoolYear,
    subjectColors: seed.subjectColors || {},
    maja: stripPersonColors(seed.maja),
    ole: stripPersonColors(seed.ole),
  };
}

function stripPersonColors(person) {
  if (!person || typeof person !== "object") return person;
  const copy = structuredClone(person);
  delete copy.subjectColors;
  return copy;
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const seed = withMeta(loadSeed());
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), "utf8");
    return structuredClone(seed);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (
      !parsed ||
      parsed.version !== DATA_VERSION ||
      !parsed.maja?.grid ||
      !parsed.ole?.grid
    ) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), "utf8");
      return structuredClone(seed);
    }
    return parsed;
  } catch {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), "utf8");
    return structuredClone(seed);
  }
}

function readSchedules() {
  return ensureData();
}

function writeSchedules(data) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
}

function normalizeColor(color) {
  const c = String(color || "white").trim();
  return BASIC_COLORS.has(c) ? c : "white";
}

function normalizeTime(value) {
  const raw = String(value || "")
    .trim()
    .replace(".", ":");
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return String(value || "").trim().slice(0, 8);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function slotLabel(start, end, fallback) {
  if (start && end) {
    return `${start.replace(":", ".")} - ${end.replace(":", ".")}`;
  }
  return String(fallback || "").slice(0, 40);
}

function normalizeCell(cell) {
  if (cell == null) return null;
  if (typeof cell !== "object") return null;
  const subject = String(cell.subject || "").trim().slice(0, 80);
  const room = String(cell.room || "").trim().slice(0, 40);
  const teacher = String(cell.teacher || "").trim().slice(0, 80);
  const color = normalizeColor(cell.color);
  if (!subject && !room && !teacher) return null;
  const out = { subject, color };
  if (room) out.room = room;
  if (teacher) out.teacher = teacher;
  return out;
}

function normalizePerson(input, fallback) {
  if (!input || typeof input !== "object") return null;
  const base = structuredClone(fallback);
  delete base.subjectColors;
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 60)
      : base.name;
  base.name = name;
  base.title = name;
  if (typeof input.klass === "string") {
    base.klass = input.klass.trim().slice(0, 20);
  }

  if (Array.isArray(input.slots) && input.slots.length) {
    base.slots = input.slots.map((s, i) => {
      const start = normalizeTime(s.start);
      const end = normalizeTime(s.end);
      return {
        id: String(s.id || `slot-${i}`).slice(0, 32),
        n: typeof s.n === "number" ? s.n : undefined,
        start,
        end,
        label: slotLabel(start, end, s.label),
        type: ["lesson", "break", "pause", "lunsj"].includes(s.type)
          ? s.type
          : "lesson",
      };
    });
  }

  const slotIds = base.slots.map((s) => s.id);
  const grid = {};
  for (const id of slotIds) {
    const row = input.grid?.[id] || {};
    grid[id] = {};
    for (const day of WEEKDAYS) {
      grid[id][day] = normalizeCell(row[day]);
    }
  }
  base.grid = grid;
  return base;
}

function collectSubjectColors(body, maja, ole, seedColors) {
  const map = {};
  // Seed first, then request body wins (shared map is source of truth when saving)
  const sources = [
    seedColors,
    body.maja?.subjectColors,
    body.ole?.subjectColors,
    body.subjectColors,
  ];
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const [subj, color] of Object.entries(src)) {
      const key = String(subj || "").trim().slice(0, 80);
      if (!key) continue;
      map[key] = normalizeColor(color);
    }
  }
  // Infer from cell colors only when subject has no mapping yet
  for (const person of [maja, ole]) {
    for (const slot of person.slots || []) {
      for (const day of WEEKDAYS) {
        const cell = person.grid?.[slot.id]?.[day];
        if (!cell?.subject) continue;
        if (!map[cell.subject] && cell.color) {
          map[cell.subject] = normalizeColor(cell.color);
        }
      }
    }
  }
  return map;
}

function applySharedColors(person, subjectColors) {
  for (const slot of person.slots || []) {
    for (const day of WEEKDAYS) {
      const cell = person.grid?.[slot.id]?.[day];
      if (!cell?.subject) continue;
      if (subjectColors[cell.subject]) {
        cell.color = subjectColors[cell.subject];
      }
    }
  }
}

function normalizeAll(body) {
  const seed = withMeta(loadSeed());
  const maja = normalizePerson(body.maja, seed.maja);
  const ole = normalizePerson(body.ole, seed.ole);
  if (!maja || !ole) return null;
  const subjectColors = collectSubjectColors(
    body || {},
    maja,
    ole,
    seed.subjectColors
  );
  applySharedColors(maja, subjectColors);
  applySharedColors(ole, subjectColors);
  return {
    version: DATA_VERSION,
    schoolYear:
      typeof body.schoolYear === "string" && body.schoolYear.trim()
        ? body.schoolYear.trim()
        : seed.schoolYear,
    subjectColors,
    maja,
    ole,
  };
}

ensureData();

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "timeplan", version: DATA_VERSION });
});

app.get("/api/schedules", (_req, res) => {
  res.json(readSchedules());
});

app.put("/api/schedules", (req, res) => {
  const next = normalizeAll(req.body || {});
  if (!next) {
    return res.status(400).json({ error: "Ugyldig timeplan-data." });
  }
  writeSchedules(next);
  res.json(next);
});

app.post("/api/schedules/reset", (_req, res) => {
  const seed = withMeta(loadSeed());
  writeSchedules(seed);
  res.json(seed);
});

app.listen(PORT, () => {
  console.log(`Timeplan kjører på http://localhost:${PORT}`);
});
