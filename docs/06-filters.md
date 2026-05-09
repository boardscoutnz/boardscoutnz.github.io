
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

### BGG rating slider (sidebar, v1.6.20)

Dual-handle range slider in its own `.sidebar-section` ("BGG Rating"),
adjacent to the Price section. Two stacked `<input type="range">` elements
share a styled track (the standard accessible pattern — keyboard works for
free, no library). The handles drive `filters.bggMinRating` and
`filters.bggMaxRating`; when a handle sits at its extreme (0 or 10) the
corresponding filter field is `null` ("no rating filter active") so
listings with `bgg_average=null` are not rejected by that side. Cross-
handle clamp prevents the handles from crossing.

Live readouts above the track update on every `input` event. Calls to
`applyFilters()` are debounced 750 ms after the last `input`. While
`applyFilters()` is mid-call the slider is locked: both inputs `disabled`
and the track gets `.is-locked` (dim thumbs) — guards against rapid re-
entrance during a heavy filter pass; under normal synchronous filter
flow the lock is essentially instantaneous. The Reset range button and
the sidebar-wide Reset filters button both snap the handles back to
[0, 10] and null both filter fields. Wiring lives in
`js/16-rating-slider.js` (extracted from `js/12-filters.js` to keep both
under the 500-line cap).

---
