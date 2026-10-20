# Timeplan

Mobilvennlig ukesplan for **Haumyrheia 8A** og **Haumyrheia 10A** (norsk UI), skoleåret **2026/2027**.

## Live (GitHub Pages)

**https://mgjessen.github.io/timeplan/**

Samme modell som [LogPad](https://github.com/mgjessen/logpad): statisk site på GitHub Pages. Endringer lagres i **localStorage** i nettleseren. Bruk **Eksporter** / **Last inn** (i Rediger) for JSON-backup mellom enheter.

Deploy: `.github/workflows/pages.yml` bygger `public/` + `data/` ved push til `main`.

## Lokalt (valgfritt Express)

```bash
npm install
npm start
```

Åpne [http://localhost:3847](http://localhost:3847). Da brukes server-API (`data/schedules.json`) i stedet for localStorage.

## Funksjoner

- Faner for Haumyrheia 8A / 10A
- Dagvelger Man–Fre
- Fargekodede fag; 8A viser rom på samme linje som fag
- **Rediger** → **Lagre** / **Avbryt**
- **Eksporter** / **Last inn** JSON-konfig
