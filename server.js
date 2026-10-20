const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3847;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "schedules.json");
const SEED_FILE = path.join(DATA_DIR, "seed.json");
const WEEKDAYS = ["man", "tir", "ons", "tor", "fre"];
const DATA_VERSION = 3;

function loadSeed() {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8"));
}

function withMeta(seed) {
  return {
    version: DATA_VERSION,
    schoolYear: seed.schoolYear,
    dayEnds: seed.dayEnds,
    maja: seed.maja,
    ole: seed.ole,
  };
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
      !parsed.ole?.grid ||
      !parsed.dayEnds
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

function normalizeCell(cell) {
  if (cell == null) return null;
  if (typeof cell !== "object") return null;
  const subject = String(cell.subject || "").trim().slice(0, 80);
  const room = String(cell.room || "").trim().slice(0, 40);
  const teacher = String(cell.teacher || "").trim().slice(0, 80);
  const color = String(cell.color || "white").trim().slice(0, 32);
  if (!subject && !room && !teacher) return null;
  const out = { subject, color: color || "white" };
  if (room) out.room = room;
  if (teacher) out.teacher = teacher;
  return out;
}

function normalizePerson(input, fallback) {
  if (!input || typeof input !== "object") return null;
  const base = structuredClone(fallback);
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 60)
      : base.name;
  base.name = name;
  // Title follows the editable display name unless an explicit title is sent
  if (typeof input.title === "string" && input.title.trim()) {
    base.title = input.title.trim().slice(0, 80);
  } else {
    base.title = name;
  }
  if (typeof input.klass === "string") base.klass = input.klass.trim().slice(0, 20);

  if (Array.isArray(input.slots) && input.slots.length) {
    base.slots = input.slots.map((s, i) => ({
      id: String(s.id || `slot-${i}`).slice(0, 32),
      n: typeof s.n === "number" ? s.n : undefined,
      label: String(s.label || "").slice(0, 40),
      type: ["lesson", "break", "pause", "lunsj"].includes(s.type)
        ? s.type
        : "lesson",
    }));
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

function normalizeDayEnds(input, fallback) {
  const out = {
    days: [...WEEKDAYS],
    maja: { ...fallback.maja },
    ole: { ...fallback.ole },
  };
  for (const person of ["maja", "ole"]) {
    for (const day of WEEKDAYS) {
      const val = input?.[person]?.[day];
      if (typeof val === "string" && val.trim()) {
        out[person][day] = val.trim().slice(0, 8);
      }
    }
  }
  return out;
}

function normalizeAll(body) {
  const seed = withMeta(loadSeed());
  const maja = normalizePerson(body.maja, seed.maja);
  const ole = normalizePerson(body.ole, seed.ole);
  if (!maja || !ole) return null;
  return {
    version: DATA_VERSION,
    schoolYear:
      typeof body.schoolYear === "string" && body.schoolYear.trim()
        ? body.schoolYear.trim()
        : seed.schoolYear,
    dayEnds: normalizeDayEnds(body.dayEnds, seed.dayEnds),
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
