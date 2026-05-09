
## Future plans

### Enrich the cache with weight / players / playing time

The CSV doesn't carry these. The `tools/` Node.js pipeline implements the
recommended path:

- Register for a BGG Application Token (free, ~10 min form).
- `tools/build-bgg-cache.mjs --top 25000` hits
  `https://boardgamegeek.com/xmlapi2/thing?id=X,Y,Z&stats=1` (≤20 IDs/call)
  with auth, ~28 req/min. Resumable via `tmp/bgg-cache-progress.json`.
- Outputs `data/bgg-cache.json` — **note the filename mismatch** with the
  site's current `BGG_RANKINGS_URL = './data/bgg-rankings.json'`. Pick one
  when wiring up.

Once that lands:

- Move `BGG_FULL_COLUMNS` ('bgg_weight', 'bgg_min_players',
  'bgg_playing_time') into `BGG_BASIC_COLUMNS` (or somewhere visible).
- Un-hide the BGG sidebar section (`#sidebar-bgg-section` in `index.html`).
- The website code already reads `weight`, `minPlayers`, `maxPlayers`,
  `playingTime`, `alternateNames` and falls back to `null` / `—` when
  absent — no website-side renames needed.

### Match-quality follow-ups

- Once `alternateNames` are populated, several documented mismatches
  (Jabba's Palace etc.) resolve for free.
- Considered but not implemented: 1-edit-distance Levenshtein on individual
  BGG tokens (length ≥5) during Tier 2 containment as a cheap typo-tolerance
  re-introduction without Fuse.
- Persisting matched `bgg_id` back into `listings.json` was considered and
  rejected — would entangle the userscript with BGG. Re-running the matcher
  on every page load is fast enough (~3-5 s).

### Userscript cleanups worth doing

- Fix `extractListingsFromPage`'s `totalCount` extraction so
  `pagesTotalEstimate` is non-null. Once that works, a smarter early-stop
  could be reintroduced into the Quick Run forward walk to bring runtime
  back down without sacrificing the lastSeenAt scheme's robustness.
- Prune the leftover `currSeenByPass` / `tailByPass` declarations and
  IndexedDB writes from `runFullFetch` (now dead code).

---
