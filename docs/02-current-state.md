
## Current state (v1.6.19, userscript v0.7.12)

BGG matching is **live and default-on**. The topbar "BGG Mode: ON" button
toggles the three BGG-derived columns (Entry / Rank / Rating); a `redraw(true)`
fires after the toggle so Tabulator re-runs `fitColumns` and the remaining
columns expand to fill the gap. Three further columns (Weight / Players /
Time) and the entire BGG sidebar filter section stay hidden until the full
BGG metadata pipeline lands — see Future plans.

Top-level corpus split: every listing is **either a base game OR an expansion**
(never both). Mode toggle in the topbar (`Board Games` / `Expansions`) flips
which half is rendered. The userscript's `detectIsExpansion()` heuristic tags
rows at normalise time — see Tampermonkey companion 1.

### Defaults

New+Used ✓, view = Board Games, BGG Mode ON, NEW-only filter OFF.

### BGG cache schema

```json
[
  {"id": 224517, "primaryName": "Brass: Birmingham", "rank": 1, "average": 8.564},
  ...
]
```

Four fields per game. Unmatched listings show a `>N` badge where **N is
`bgg.games.length`**, not a hardcoded constant — rebuild with 5,000 entries
and the badge auto-reads `>5,000`. There is no `RANK_THRESHOLD` constant any
more; "unranked" semantically means `bgg_id == null`.

---
