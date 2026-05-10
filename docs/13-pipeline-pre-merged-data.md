# 13 — Pipeline pre-merged data file

## Purpose

`data/bsnz.json` is the new pipeline's pre-merged data file: a single,
fully-enriched JSON document written by `tprmky/bsnz-pipeline.user.js` and
read by the static site (post-Step-8) as its sole input. It replaces the
runtime join the site currently performs across `data/listings.json` and
`data/bgg-rankings.json` — the merge is moved upstream into the userscript so
the page can render immediately without doing matching work in the browser.

## Schema (reference)

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-05-10T14:30:00Z",
  "bgg_csv_dump_fetched_at": "2026-05-10T14:25:00Z",
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

This schema supersedes the older example in the master plan; the older
draft included TM and BGG fields that have been removed (see below).

## Field documentation

### Top-level

| Field | Type | Notes |
|---|---|---|
| `schema_version` | string (semver) | Reader refuses to render incompatible MAJOR. |
| `generated_at` | ISO 8601 UTC | Timestamp of this pipeline run. |
| `bgg_csv_dump_fetched_at` | ISO 8601 UTC \| null | Timestamp of the most recent BGG ranks CSV download. Null on a fresh placeholder. |
| `bgg_api_enrichment_run` | boolean | True if this run hit the BGG XML `/thing` API to refresh weight / players / playing_time fields; false if those values were carried over from the previous `data/bsnz.json` (or are null because no prior value existed). |
| `stats` | object | Aggregate counters for the run — see below. |

`stats` keys: `tm_listing_count`, `bgg_match_count`,
`manual_override_count`, `unmatched_count`, `bgg_api_enriched_count`.

### Per-listing — TM-sourced (Trade Me listing-card scrape)

`tm_id`, `tm_url`, `tm_title`, `tm_price_nzd`, `tm_buy_now_nzd`,
`tm_condition`, `tm_location`.

These are the only TM fields the userscript reliably extracts. Older drafts
of the schema included `tm_seller`, `tm_listed_at`, `tm_closes_at`, and
`tm_image_url`; these have been removed because the listing-card scrape does
not reliably yield them.

### Per-listing — BGG-CSV-sourced

Always populated when matched; refreshed every run.

- `bgg_id` (int, BGG's primary key)
- `bgg_name` (BGG primary name)
- `bgg_rank` (overall rank)
- `bgg_rating_average` (BGG's displayed weighted-average rating)

Source: <https://boardgamegeek.com/data_dumps/bg_ranks>. No API calls
required for these fields.

### Per-listing — match metadata

- `bgg_match_method`: one of
  `"exact_match"` | `"fuzzy_match"` | `"manual_override"` | `"unmatched"`.
  The earlier proposed values `"exact_search"` and `"cached"` are dropped:
  matching now happens against the local CSV corpus rather than against an
  API search endpoint.
- `bgg_match_confidence`: `1.0` for exact / manual; `<1.0` for fuzzy;
  `null` for unmatched.

### Per-listing — BGG-API-conditional

Populated only when the `enable_bgg_api_enrichment` setting is checked;
otherwise carried over from the previous `data/bsnz.json` keyed by `bgg_id`,
or `null` if no prior value exists.

- `bgg_weight` (BGG game complexity, 1.0–5.0)
- `bgg_min_players`
- `bgg_max_players`
- `bgg_playing_time` (minutes)
- `bgg_api_enriched_at`: ISO 8601 UTC timestamp at which these four fields
  were last refreshed for this `bgg_id`. Null if never enriched.

### Per-listing — BGG-API best-effort

Stored only when the same `/thing` response that populated the conditional
fields above also returns them; otherwise null / empty arrays.

- `bgg_min_age`
- `bgg_categories` (array of strings)
- `bgg_mechanics` (array of strings)

### Unmatched listings

Listings with `bgg_match_method` `"unmatched"` have `bgg_id` null and all
`bgg_*` fields null / empty arrays; the static site still renders these
with their `tm_*` fields.

## Schema versioning rule

Any breaking change to the listing record shape MUST bump
`schema_version` (semver):

- MAJOR for breaking changes,
- MINOR for additive changes,
- PATCH for clarifications.

The reader (post-Step-8) reads `schema_version` and refuses to render
incompatible major versions.

## Update cadence

Written by `tprmky/bsnz-pipeline.user.js`, which the user runs manually —
not on a schedule. The BGG ranks CSV upstream refreshes weekly; the
userscript caches it locally to avoid unnecessary re-downloads. The
cache-cadence config arrives in Step 3 of the implementation plan.

## Sourcing summary

TM fields come from scraping the authenticated Trade Me board-games
category in the user's browser tab. BGG-CSV fields (`bgg_id`, `bgg_name`,
`bgg_rank`, `bgg_rating_average`) come from the BGG ranks data dump and are
the primary BGG matching corpus — no API calls are needed for these.
BGG-API fields (`bgg_weight`, players, `bgg_playing_time`, plus the
optional `bgg_min_age` / `bgg_categories` / `bgg_mechanics`) come from the
BGG XML `/thing` endpoint ONLY when the user has
`enable_bgg_api_enrichment` checked. When unchecked, those values are
carried over from the previous `data/bsnz.json` keyed by `bgg_id`; this
minimises load on the BGG API while keeping the per-listing record
complete from the static site's point of view.

## File location

`data/bsnz.json` (committed to the repo).

## Relationship to existing data files

Current contents of `data/`:

- `bgg-rankings.json` — produced by `tprmky/bgg-ranks-exporter.user.js`;
  the BGG ranks corpus the static site currently joins against at runtime.
- `bgg-rankings-example.json` — small sample for documentation / examples.
- `listings.json` — produced by `tprmky/tm-bgbf.user.js`; the TM listings
  corpus the static site currently joins against at runtime.
- `listings-example.json` — small sample for documentation / examples.

Step 9 of the implementation plan will deprecate or archive whichever of
the above are superseded by `data/bsnz.json` once the static site has been
switched (Step 8) to read the pre-merged file. Until then, both the old
files and the new `data/bsnz.json` placeholder coexist.
