## Pipeline pre-merged data

`data/bsnz.json` is the single source the static site reads (post-cutover —
see implementation-plan Step 8) to render the Tabulator grid. It is a fully
merged, pre-enriched snapshot of every Trade Me board-game listing joined
with its BoardGameGeek metadata, written by `tprmky/bsnz-pipeline.user.js`
(built from `tprmky/bsnz-pipeline-src/`) on each manual pipeline run and
committed via the GitHub Contents API. The site does no merging or BGG
enrichment at render time.

### Schema


```json
{
  "schema_version": "1.1.0",
  "generated_at": "2026-05-10T14:30:00Z",
  "bgg_corpus_fetched_at": "2026-05-10T14:25:00Z",
  "bgg_api_enrichment_run": true,
  "stats": {
    "tm_listing_count": 247,
    "bgg_match_count": 231,
    "manual_override_count": 4,
    "unmatched_count": 12,
    "bgg_api_enriched_count": 231
  },
  "listings": [
    {
      "tm_id": "1234567890",
      "tm_url": "https://www.trademe.co.nz/marketplace/...",
      "tm_title": "Wingspan Asia Expansion",
      "tm_price_nzd": 45.00,
      "tm_buy_now_nzd": 60.00,
      "tm_condition": "Used",
      "tm_location": "Auckland",
      "tm_subcat": "strategy-war-games",

      "bgg_id": 266524,
      "bgg_match_method": "exact_match",
      "bgg_match_confidence": 1.0,

      "bgg_name": "Wingspan: Asia",
      "bgg_rank": 142,
      "bgg_rating_average": 8.1,

      "bgg_weight": 2.45,
      "bgg_min_players": 1,
      "bgg_max_players": 5,
      "bgg_playing_time": 60,
      "bgg_api_enriched_at": "2026-05-03T10:12:00Z",

      "bgg_min_age": 14,
      "bgg_categories": ["Animals", "Educational"],
      "bgg_mechanics": ["Engine Building", "Variable Player Powers"]
    }
  ]
}
```


### Top-level fields

- `schema_version` — semver string. The site reader refuses to render an
  incompatible MAJOR.
- `generated_at` — ISO 8601 UTC timestamp of this pipeline run.
- `bgg_corpus_fetched_at` — ISO 8601 UTC timestamp of when the in-userscript
  BGG corpus was last refreshed from the BGG ranks dump (either this run, or
  a recent run whose cached corpus was reused). Null on the empty placeholder.
- `bgg_api_enrichment_run` — `true` if this run hit the BGG XML `/thing` API
  to refresh `bgg_weight` / `bgg_min_players` / `bgg_max_players` /
  `bgg_playing_time` (and the optional best-effort fields); `false` if those
  values were carried over from the previous `data/bsnz.json` (or are null
  because no prior value exists).
- `stats` — aggregate counters for the run.

### Per-listing fields, by source

**TM-sourced** (Trade Me listing-card scrape; populated for matched and
unmatched listings alike):

`tm_id`, `tm_url`, `tm_title`, `tm_price_nzd`, `tm_buy_now_nzd`,
`tm_condition`, `tm_location`, `tm_subcat`.

These are the only TM fields the userscript reliably extracts. Earlier drafts
of this schema included `tm_seller` / `tm_listed_at` / `tm_closes_at` /
`tm_image_url` — those are explicitly out of scope.

- `tm_subcat` — Trade Me subcategory slug — one of the 8 values in
  `TM_SUBCATS` in `00-config.js`. Set during scraping; identifies which subcat
  the listing was first found in (dedupe is first-subcat-wins across the 8
  paths).

**BGG-CSV-sourced** (read from the BGG ranks CSV dump fetched in-userscript
by `03-bgg-corpus.js`; populated whenever a match exists; refreshed when the
cache is older than the configured TTL or the user clicks Force-refresh):

- `bgg_id`, `bgg_name`, `bgg_rank`, `bgg_rating_average`.

**Match metadata**:

- `bgg_match_method` — one of `"exact_match" | "fuzzy_match" |
  "manual_override" | "unmatched"`. (Earlier proposed values `"exact_search"`
  and `"cached"` are dropped: matching now happens against the local
  CSV-derived corpus rather than against an API search endpoint.)
- `bgg_match_confidence` — `1.0` for exact / manual; `<1.0` for fuzzy; `null`
  for unmatched.

**BGG-API-conditional** (populated only when `enable_bgg_api_enrichment` is
checked; otherwise carried over from the previous `data/bsnz.json` keyed by
`bgg_id`, or null if no prior value exists):

`bgg_weight` (BGG game complexity, 1.0–5.0), `bgg_min_players`,
`bgg_max_players`, `bgg_playing_time` (minutes).

`bgg_api_enriched_at` — ISO 8601 UTC timestamp at which these fields were
last refreshed for this `bgg_id`. Null if never enriched.

**BGG-API best-effort** (stored only when the same `/thing` response that
populated the conditional fields above also returns them; otherwise
null/empty):

`bgg_min_age`, `bgg_categories` (array of strings), `bgg_mechanics` (array of
strings).

Listings with `bgg_match_method: "unmatched"` have `bgg_id: null` and all
`bgg_*` fields null/empty; the static site still renders them with their
`tm_*` fields populated.

### Sourcing summary

TM fields come from scraping the authenticated Trade Me board-games category
in the user's browser tab. BGG-CSV fields (id, name, rank, rating_average)
come from the BGG ranks ZIP dump fetched directly by `03-bgg-corpus.js` from
`https://boardgamegeek.com/data_dumps/bg_ranks` (using the user's BGG session
cookies), unzipped with `fflate`, parsed, and cached in `GM_setValue` with a
configurable TTL (default 7 days). BGG-API fields (weight, players,
playing_time, plus the optional min_age / categories / mechanics) come from
the BGG XML `/thing` endpoint ONLY when the user has
`enable_bgg_api_enrichment` checked. When unchecked, those values are carried
over from the previous `data/bsnz.json` keyed by `bgg_id`.

### Schema versioning

Any breaking change to the listing record shape MUST bump `schema_version`
(semver: MAJOR for breaking, MINOR for additive, PATCH for clarifications).
The reader (the static site, post-cutover) reads `schema_version` and
refuses to render incompatible major versions.

### Update cadence

Written by `tprmky/bsnz-pipeline.user.js`, run manually by the user. Not on a
schedule.

The matching corpus (BGG ranks dump) is fetched directly from BGG by the
pipeline userscript on each run, then cached in `GM_setValue` with a
configurable TTL (default 7 days, matching BGG's upstream weekly refresh
cadence). The user can force a corpus refresh via the settings dialog.

The optional BGG XML `/thing` API enrichment runs only when the user has the
"Enable BGG API enrichment" setting checked. When unchecked, the conditional
fields carry over from the previous `data/bsnz.json`.

### File location

`data/bsnz.json` — committed to the repo via the GitHub Contents API by the
pipeline userscript. Fetched by the static site at render time as a single
file.

### Build-time module convention

Files in `tprmky/bsnz-pipeline-src/` are concatenated by `tprmky/build.sh` in
lexicographic order to produce `tprmky/bsnz-pipeline.user.js`. The convention
mirrors `tprmky/tm-bgbf-src/`:

- `00-config.js` opens the IIFE and emits the `// ==UserScript== … // ==/UserScript==`
  header. It must remain the first file.
- `99-footer.js` closes the IIFE with `})();`. It must remain the last file.
- All functional modules sit between (`01-ui.js`, `02-tm-scraper.js`,
  future `03-…` through `06-…`).

The TM scraper module (`02-tm-scraper.js`, added in Step 4 of the pipeline
plan) exposes one entry point — `runScrapePhase(signal)` — which walks the 8
hardcoded subcategory paths in `TM_SUBCATS` (defined in `00-config.js`,
ported verbatim from the legacy `tprmky/tm-bgbf-src/01-constants.js`
`CATEGORIES` array). For each subcat it starts at `TM_ORIGIN + subcat.path`
and paginates via `?page=N`, fetching each page through `GM_xmlhttpRequest`
and parsing the embedded `__NEXT_DATA__` JSON (with a DOM-card selector
fallback ported from `tprmky/tm-bgbf-src/08-extraction.js`). Listings are
deduped by `tm_id` across all 8 subcats (first-subcat-wins) and each emitted
record is tagged with `tm_subcat: subcat.slug` in the post-dedupe loop —
the parsers themselves stay subcat-agnostic. Records are written into
`BSNZ.tm_listings` using the TM-sourced field names defined above (`tm_id`,
`tm_url`, `tm_title`, `tm_price_nzd`, `tm_buy_now_nzd`, `tm_condition`,
`tm_location`, `tm_subcat`) and `BSNZ.stats.tm_scraped` is updated after
each page. Pacing — both page-to-page within a subcat and between subcats —
is `BSNZ.config.pacing_multiplier × TM_REQUEST_DELAY_MS`. The phase honours
an `AbortSignal` — `01-ui.js` creates a fresh `AbortController` on each Run
click, stores it as `BSNZ.abortController`, and the Cancel button calls
`abort()`.

Termination signal (v0.4.0+). Each subcat stops when the SSR HTML for the
current page lacks an `a[aria-label^="Next page"]` element — this is TM's
own pagination widget, present on every real-inventory page and absent
entirely past the end of the result set. The total result count is parsed
once from the `h3.tm-search-header-result-count__heading` element on page 1
("Showing N results", commas stripped) and is used purely for the per-subcat
header log and a post-loop sanity summary; nothing depends on it for
control flow. `TM_MAX_PAGES_PER_SUBCAT` (currently 75) remains as a
defensive fail-safe — if it ever fires, TM's pagination markup likely
changed and the parser's selectors need updating, which is logged at WARN.

The matcher module (`05-fuzzy-match.js`, added in Step 6 of the pipeline
plan) exposes one entry point — `runMatchPhase(signal)` — which iterates
the unique `tm_title` values from `BSNZ.tm_listings`, applies any
GM-stored manual override first (key `override:<normName>` from
`03-bgg-corpus.js`'s `getOverride` / `setOverride`), and otherwise calls
the local `matchTitle(rawTitle, normTitle)` three-tier matcher. Tier 1 is
a `BSNZ.bgg_corpus.byNormName.get` exact-string lookup. Tier 2 is the
same multi-set token containment + position scoring as `js/06-matching.js`
(earliest position → longest BGG name → contiguous → in-order → better
rank; single-token candidates must sit at listing position 0 and meet
`MIN_SINGLE_TOKEN_LEN`; 2-token out-of-order matches are rejected). Tier 3
is a Fuse.js fuzzy fallback over `BSNZ.bgg_corpus.nameEntries` (keys
`['normName']`, threshold `FUZZY_MATCH_THRESHOLD = 0.4`); unlike the
site-side matcher (which keeps Fuse disabled) the userscript runs once per
pipeline run against the deduped unique titles, so the cost is bounded.
Resolved hits land in `BSNZ.title_to_bgg` as
`{id, method: 'exact_match'|'fuzzy_match'|'manual_override', confidence}`;
unresolved titles land in `BSNZ.unmatched_titles = [{raw, norm}, …]`.
When `unmatched_titles` is non-empty the phase calls
`window.bsnzShowUnmatched()` (registered by `01-ui.js`), which renders an
inline "Unmatched titles" section in the panel body: each row shows the
raw TM title, a numeric BGG ID input, a Save button (validates the ID
against `BSNZ.bgg_corpus.byId` before persisting via `setOverride`), a
"Search BGG" link to `boardgamegeek.com/geeksearch.php`, and a Skip
button (sentinel override `setOverride(norm, null)` that suppresses the
title in future runs). Overrides persist across Tampermonkey reloads.

The IIFE closer lives in `99-footer.js` so every intermediate build artefact is
syntactically valid JavaScript. Do not add `})();` to any other file, and do
not add UserScript header directives outside `00-config.js`.

### Relationship to existing data files

- `data/listings.json` — produced by `tprmky/tm-bgbf.user.js` (the legacy TM
  scraper). Deprecated by this pipeline; archived in Step 9 of the
  implementation plan.
- `data/bgg-rankings.json` — produced by `tprmky/bgg-ranks-exporter.user.js`.
  Deprecated by this pipeline (which now refreshes the BGG corpus
  in-userscript on every run via fflate-decompressed access to BGG's CSV
  dump); both the exporter and this file are archived in Step 9 of the
  implementation plan.
