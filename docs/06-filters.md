
## Filter system (cross-facet dynamic counts)

**Single source of truth**: `passesFilters(row, opts)` is the predicate used
by both the live grid filter (`applyFilters`) and the sidebar facet counter.
Options: `excludeRegions`, `excludeSubcats`, `onReject`.

**Cross-facet rule**: each facet's COUNTS reflect every active filter EXCEPT
that facet's own selections.

| Action                                                   | Region counts | Sub-cat counts |
|----------------------------------------------------------|:-------------:|:--------------:|
| Toggle Condition / Search / Price / NEW-only             | ✅            | ✅             |
| Tick a Region                                            | ❌            | ✅             |
| Tick a Sub-category                                      | ✅            | ❌             |
| Switch view mode                                         | full rebuild  | full rebuild   |

`computeFacetCounts()` runs `passesFilters` with each `exclude*` flag.
`refreshFacetCounts()` updates `(N)` text spans in place, preserving user
checkbox state. Single chokepoint — `applyFilters()` calls
`refreshFacetCounts()` once at the tail.

Clause order in `passesFilters`: viewMode → newListingsOnly → conditions →
search → priceMin/Max → regions → subcats → BGG facets. The
rejection-breakdown debug log relies on this order (it counts the FIRST
failing clause per row).

---
