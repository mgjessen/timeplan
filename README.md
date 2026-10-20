# Timeplan

Mobilvennlig ukesplan for **Haumyrheia 8A** og **Haumyrheia 10A** (norsk UI), skoleåret **2026/2027**.

Endringer lagres på serveren i `data/schedules.json` (startes fra `data/seed.json`).

## Kom i gang

```bash
npm install
npm start
```

Åpne [http://localhost:3847](http://localhost:3847).

## Funksjoner

- Faner for Haumyrheia 8A / 10A (navn er redigerbare)
- Dagvelger Man–Fre (én dag om gangen)
- Oppstart: dagens skoledag, eller neste dag etter kl. 15:00 (helg → mandag)
- Fargekodede fag; 8A har også rom og lærer
- **Rediger** → **Lagre** (server) / **Avbryt**

## API

- `GET /api/schedules` — hent timeplaner
- `PUT /api/schedules` — lagre hele datasettet
- `POST /api/schedules/reset` — tilbakestill til seed
