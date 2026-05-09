# Tampermonkey scripts

This folder holds the two userscripts the project relies on for data
acquisition. The website itself only ever reads the static JSON files
they produce — neither script runs in the browser context that serves
`index.html`.

## Contents

| Path | Role |
|------|------|
| `tm-bgbf.user.js`         | **Trade Me Board Games Bulk Fetcher** — single-file deployable, **assembled** from the sources in `tm-bgbf-src/` by `build.sh`. Edit the source files, not this. |
| `tm-bgbf-src/`            | The 18 source pieces that `build.sh` concatenates into `tm-bgbf.user.js`. See the module map below. |
| `bgg-ranks-exporter.user.js` | **BGG Ranks Exporter** — single-file userscript, kept as one file (small enough that splitting buys nothing). Run it on a BoardGameGeek browse page to walk pages and export a ranks JSON. |
| `build.sh`                | Reassembles `tm-bgbf.user.js` from `tm-bgbf-src/`. |

The split-source / single-deployable pattern only applies to
`tm-bgbf.user.js`; `bgg-ranks-exporter.user.js` is installed and edited
as a single file.

---

## tm-bgbf userscript — module map

The deployable that actually gets installed into Tampermonkey is
`tm-bgbf.user.js` — a single file that the runtime ingests as a classic
IIFE. It is **assembled** from the small, focused source files in
`tm-bgbf-src/` by running `./build.sh` from this directory.

### Why split sources but a single deployable?

Tampermonkey can only install a single `.user.js` file. Keeping the
sources as small numbered chunks lets a single section (network fetcher,
extraction, normaliser, UI, …) be regenerated independently without
rewriting the rest of the script. After any edit in `tm-bgbf-src/`,
running `build.sh` reassembles `tm-bgbf.user.js` byte-for-byte.

The build is a plain `cat *.js > tm-bgbf.user.js` in numeric filename
order — no preprocessor, no transformation, no esbuild. The split files
together literally form one IIFE: `00-header.js` opens it, every
numbered file in between contributes body statements, and
`99-footer.js` closes it. Each individual source file is therefore
**not independently valid JavaScript**; only the assembled output is.

### Workflow

1. Edit the relevant source file in `tm-bgbf-src/`.
2. Run `./build.sh` from this directory (`tprmky/`).
3. In Tampermonkey: refresh the script (paste the new file contents, or
   if installed via "Install from URL", push to GitHub and click
   "Check for updates").

### Module map

The numbers correspond to filename prefixes; gaps in the scheme reflect
sections that were dropped over the script's history (originally there
were sections 9, 10, 13 — those numbers are intentionally not reused).

| File | What it contains |
|------|------------------|
| `00-header.js` | The Tampermonkey banner (`==UserScript==` block) with all `@grant` / `@match` / `@connect` directives. The IIFE opener `(function () { 'use strict'; … })`. The earliest console.log that proves the script file was even evaluated by the browser. |
| `01-constants.js` | `VERSION`, `LOG_PREFIX`, `STORAGE_KEYS`, `DB_NAME` / `DB_VERSION` / `STORE_*`, blacklist + expansion-detection regex sources (`PURGE_TITLE_KEYWORDS`, `EXPANSION_TRIGGER_RX`, `BASE_GAME_QUALIFIER_RX`), the legacy-fields strip list, `STALE_LISTING_DAYS`, `LEGACY_FIELDS`, the listings-sampler tuning constants, and the user-facing `categories[]` table. |
| `02-logging.js` | `log()`, `warn()`, `err()`, `dbg(category, …)`, `grp()/grpEnd()`, `startTimer()`, the per-category mute helpers, and `dbgErr()`. The console-tagging system every other section calls into. |
| `03-bootstrap-diag.js` | The one-shot environment dump that fires at script eval time — page URL, document.readyState, `window.GM_*` capability sniffing, etc. Useful when the script "just doesn't run". |
| `04-utilities.js` | `nowIso()`, `sleep()`, `withRetry()`, the listing-id parsers, `slimListingForExport()`, `arraysEqual()`, `groupBy()`, deep-merge helper, JSON sanitiser, etc. Reusable helpers used across multiple sections. |
| `05-settings.js` | Settings persistence layer (GM_setValue / GM_getValue) — the per-user knobs surfaced in the UI: stale-listing days, batch size, etc. |
| `06-indexeddb.js` | `openDb()`, `getAllListings()`, `putListings()`, `clearAllListings()`, `getMeta()/setMeta()`, the schema-upgrade migrations, and the helpers that wrap raw `IDBRequest` events in promises. The two stores: `STORE_LISTINGS` (keyPath `listingId`, indexed by `subcat`) and `STORE_META`. |
| `07-network.js` | `httpGet(url, opts)` — the GM_xmlhttpRequest wrapper, polite-delay logic, retry loop, and Cloudflare-challenge detection. The single chokepoint every fetch goes through. |
| `08-extraction.js` | `extractListingsFromPage(html)`. Three fallback parsers in order: Next.js `__NEXT_DATA__` JSON → Next.js Flight stream → DOM cards. Each parser is a separate function; they're tried in turn until one returns a non-empty array. |
| `09-normaliser.js` | `normaliseListing(raw)` — the per-row shape converter that produces the exported listing schema (`listingId`, `title`, `subcat`, `condition`, `isExpansion`, `isNewListing`, `priceNumeric`, `priceDisplay`, `priceLabel`, `hasBuyNow`, `region`, `url`). Calls into `detectIsExpansion()` and the title-blacklist regex. |
| `10-url-builders.js` | The Trade Me search-URL constructors — converts a `(subcat, condition, page)` triple into a TM listings URL. Tiny but isolated for testability. |
| `11-orchestrators.js` | The two top-level run modes: `runQuickRun()` (forward walk, every active listing's `lastSeenAt` refreshed) and `runFullFetch()` (multi-pass crawl + sweep). Calls into network + extraction + normaliser + DB. The big one — ~410 lines — but cohesive: every line is part of one of these two state machines. |
| `12-postprocess.js` | `reapAndDedup()` — the two-pass cleanup that runs after every Quick Run and Full Fetch. Pass 1: stale-listing reap (`lastSeenAt > STALE_LISTING_DAYS`). Pass 2: content-based dedup (group by `(title|priceNumeric|condition|region|subcat)`, keep highest `listingId`). Also: `purgeBlacklistedAndRetagExpansions()`, the "🧹 Re-purge existing data" implementation. |
| `13-export.js` | `exportListings(reason)` and `buildListingsSample()`. Produces `listings.json` (full) and `listings-example.json` (≤160-row sample, balanced across subcats). Wrapper schema: `{version, schemaVersion: 7, exportedAt, reason, stats, listings, meta}`. |
| `14-ui.js` | The Shadow-DOM control panel: `ensureUI()`, the four buttons (Quick Run / Full Fetch / Export / Clear DB), the status row, and all the inline CSS (kept inside the shadow root so it can't leak into or be overridden by the host page). The biggest non-orchestrator file. |
| `15-menu.js` | `registerMenuCommands()` — the GM_registerMenuCommand entries that show up in Tampermonkey's userscript menu (the icon dropdown). The "🧹 Re-purge existing data" / "🗑 Clear all listings" / "🩺 Run fetch test" / etc. items. |
| `16-init.js` | `init()` — the boot sequence: ensureUI → registerMenuCommands → openDb (async). Plus the `pageshow` (bfcache) and `load` (UI-host-missing recovery) handlers, and the `DOMContentLoaded`/already-loaded dispatch. |
| `99-footer.js` | The IIFE closer `})();`. |

### Adding a new file

1. Create `tm-bgbf-src/NN-name.js` with whatever number slots between
   the relevant existing files. (The build sorts by filename, so 17, 18,
   19 are all available between `16-init.js` and `99-footer.js`.)
2. The file just contains body statements — no IIFE wrapping, no
   `'use strict'` (already in 00-header.js), no closing parens. It runs
   inside the shared closure.
3. Add a row to the table above with a one-paragraph summary.
4. Run `./build.sh` to roll the change into `tm-bgbf.user.js`.

### Adding to or changing the userscript metadata

Anything that goes between `// ==UserScript==` and `// ==/UserScript==`
lives in `00-header.js`. New `@grant` / `@connect` / `@match` directives
go there; bumping `@version` happens there too.

### Conventions

- **No imports/exports**: every source file's top-level declarations
  share one closure scope (the IIFE in 00-header.js / 99-footer.js).
- **Naming**: function declarations are visible from any file via
  hoisting; `const` / `let` declarations are visible from any file
  declared **later** in the build order. Put constants used by many
  files in `01-constants.js`, helpers used by many files in
  `04-utilities.js`.
- **Don't break the build by introducing per-file IIFEs** — they'd
  hide internal helpers from later files.
- **Don't break the build by adding a `'use strict';` directive in
  body files** — the directive in 00-header.js already covers everything
  inside the IIFE; a stray duplicate in the middle is a syntax error.

---

## bgg-ranks-exporter.user.js

Single-file userscript that runs on `boardgamegeek.com/browse/boardgame`
pages, walks through the rank pages, and produces a JSON export of game
metadata (rank, name, year, rating, weight, players, time) used by the
website's BGG matching pipeline. Install it directly into Tampermonkey
from this file — there is no build step. Edit it directly when changes
are needed; if it ever grows large enough to warrant splitting, the
same pattern as `tm-bgbf-src/` can be applied.
