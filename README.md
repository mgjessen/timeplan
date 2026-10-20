# Timeplan

Mobilvennlig ukesplan for **Haumyrheia 8A** og **Haumyrheia 10A** (norsk UI), skoleåret **2026/2027**.

## Hosting (som LogPad)

[LogPad](https://github.com/mgjessen/logpad) er **statisk GitHub Pages** (`https://mgjessen.github.io/logpad/`) med **localStorage** — ingen server.

Timeplan trenger **delt lagring** mellom enheter, så den bruker nærmeste GitHub-native modell:

| Modus | Når | Lagring |
| --- | --- | --- |
| **Express** | `npm start` lokalt | `data/schedules.json` via `/api/schedules` |
| **GitHub Pages** | `https://mgjessen.github.io/timeplan/` | Samme JSON-fil via **GitHub Contents API** (skriving krever PAT i nettleserøkten) |

Workflow: `.github/workflows/pages.yml` deployer `public/` + `data/` til Pages ved push til `main`.

Live URL (etter Pages er aktivert på public repo): **https://mgjessen.github.io/timeplan/**

## Kom i gang (lokal server)

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
- **Rediger** → **Lagre** / **Avbryt**

## API (Express)

- `GET /api/schedules` — hent timeplaner
- `PUT /api/schedules` — lagre hele datasettet
- `POST /api/schedules/reset` — tilbakestill til seed

## GitHub Pages-lagring

Første lagring på Pages ber om et GitHub PAT med **Contents: Write** på dette repoet. Tokenet lagres bare i `sessionStorage` (ikke i repoet).
