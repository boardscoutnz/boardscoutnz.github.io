
## Debug system

### Website (`app.js`)

Structured per-category console logs tagged `[bsnz +Xs][category]`.
Categories: `init`, `data`, `bgg`, `match`, `filter`, `sort`, `ui`,
`tabulator`, `export`. Compile-time toggle is `DEBUG` at top of `app.js`;
runtime via `BSNZ_DEBUG` / `BSNZ.muteCategory(cat)`.

Console helpers (all on `window.BSNZ`):

- `BSNZ.help()` — lists every helper.
- `BSNZ.getState()` — one-shot snapshot of everything.
- `BSNZ.matchTrace("listing title")` — runs `matchTitle` and logs the
  normalised form, listing tokens, every Tier 2 candidate (with rank /
  contiguity / in-order / position), the winning tier, and the result.
  Primary tool for accuracy auditing.
- `BSNZ.diagnoseGrid()` — virtual-DOM render state + scroll-desync
  detection.
- `BSNZ.fixGrid()` — recover from scroll desync / blank grid.
- `MATCH_SLOW_LISTING_MS` (default 25 ms) — any single `matchTitle` call
  exceeding this threshold logs a warning with the title and tier, useful
  for spotting pathological cases.

### Tampermonkey scripts

- TM collector: `[bgbf]` + per-subsystem dbg helpers. Watch for
  `Quick Run cleanup: reaped=X, dupesRemoved=Y` / `Full Fetch cleanup:
  reaped=X, dupesRemoved=Y` after every run — first run after an upgrade
  often reaps a large number, subsequent runs should reap small numbers.
  The "🧹 Re-purge existing data" menu command is the easiest way to see
  the blacklist / expansion classifier run end-to-end on the existing
  corpus.
- BGG ranks exporter: `[bsnz-bgg][category]` with a summary object on
  success/failure.