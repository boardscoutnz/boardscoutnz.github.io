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
  "schema_version": "1.0.0",
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
`tm_condition`, `tm_location`.

These are the only TM fields the userscript reliably extracts. Earlier drafts
of this schema included `tm_seller` / `tm_listed_at` / `tm_closes_at` /
`tm_image_url` — those are explicitly out of scope.

**BGG-CSV-sourced** (read from the BGG ranks CSV dump fetched in-userscript
by `03-bgg-corpus.js`; populated whenever a match exists; refreshed when the
`GM_setValue` cache is older than the configured TTL or the user clicks
Force-refresh):

`bgg_id` (int, BGG's primary key), `bgg_name` (BGG primary name), `bgg_rank`
(overall rank), `bgg_rating_average` (BGG's displayed weighted-average
rating).

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

### Relationship to existing data files

- `data/listings.json` — produced by `tprmky/tm-bgbf.user.js` (the legacy TM
  scraper). Deprecated by this pipeline; archived in Step 9 of the
  implementation plan.
- `data/bgg-rankings.json` — produced by `tprmky/bgg-ranks-exporter.user.js`.
  Deprecated by this pipeline (which now refreshes the BGG corpus
  in-userscript on every run via fflate-decompressed access to BGG's CSV
  dump); both the exporter and this file are archived in Step 9 of the
  implementation plan.
