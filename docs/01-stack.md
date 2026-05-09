
## Stack

Plain HTML/CSS/JS, **no build step on the website**. CDN: Tabulator 6.3.1,
Fuse.js 7.0.0 (loaded but currently unused — see Matching).

```
boardscoutnz/
├── index.html
├── app.js                    ← all app logic, single IIFE (~2950 lines)
├── app.css                   ← ~750 lines, no preprocessor
├── logo.png, favicon.*, apple-touch-icon.png, site.webmanifest (theme #2c3e50)
├── data/
│   ├── listings.json                ← TM snapshot (committed)
│   ├── listings-example.json        ← ~150-row sample for debug/context
│   ├── bgg-rankings.json            ← BGG ranks cache (committed)
│   └── bgg-rankings-example.json    ← top-100 sample
├── tampermonkey/
│   ├── tm-bgbf.user.js              ← Trade Me scraper (v0.7.12)
│   └── bgg-ranks-exporter.user.js   ← BGG ranks exporter (v0.2.0)
└── tools/                           ← Node.js build pipeline (planned/in-progress)
    ├── README.md
    ├── package.json                 ← build:csv-only / build:full / build:resume
    └── build-bgg-cache.mjs          ← uses BGG XML API, outputs bgg-cache.json
```

The website currently consumes `data/bgg-rankings.json` produced by the
**userscript** (CSV-only, fast). The `tools/` Node.js pipeline is the planned
path for adding weight/players/playing-time via the BGG XML API — it outputs
`bgg-cache.json` (different filename), so wiring it up will require either
updating `BGG_RANKINGS_URL` in app.js or having the tool overwrite
`bgg-rankings.json`.

---
