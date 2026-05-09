
## Gotchas — read before editing

### Tabulator 6.x: events vs callbacks

`tableBuilt` and `dataSorted` are **events**, not callbacks. Subscribe via
`table.on(...)` *after* the constructor returns. Putting them in constructor
options (pre-6.x style) makes them silently never fire — symptom: stats bar
stuck at "no data loaded" and default filters never applied. `rowFormatter`
*is* a callback and stays in the constructor.

### Multi-column sort — 4 interlocking pieces

1. **`mySorters` is the source of truth**, not `table.getSorters()`. Stored
   as `[{column, dir}, ...]` in priority order; index 0 is primary.
2. **Capture-phase click handler on `#grid`** intercepts header clicks
   before Tabulator's own. Plain click → replace. Shift-click on new
   column → **append at end**. Shift-click on existing column → toggle
   direction in place.
3. **`sortOrderReverse: true`** in the constructor. Without it, array order
   is interpreted as application order (last entry = primary), the opposite
   of what `mySorters` represents.
4. **Deep-copy when handing `mySorters` to Tabulator**:
   `table.setSort(mySorters.map(s => ({column: s.column, dir: s.dir})))` —
   never `mySorters.slice()`. Tabulator mutates `sorter.column` in place
   (string → `ColumnComponent` reference); a shallow copy lets that
   mutation leak back into `mySorters`.

### Sort priority badges

Painted only when `mySorters.length >= 2`. **Prepended** as the first child
of `.tabulator-col-title` (not `.tabulator-col-title-holder` — that breaks
flex layout) so Tabulator's `text-overflow: ellipsis` clips the title rather
than the badge. `headerTooltip: true` in `columnDefaults` restores the full
title on hover. The MutationObserver that re-applies badges after Tabulator
re-renders the header is **scoped to `.tabulator-header`**, NOT the whole
`#grid` — observing the body fires the callback on every virtual-DOM row
mutation during scroll and causes wheel-scroll stutter.

### Virtual-DOM scroll-desync

When `setFilter` / `replaceData` / `setSort` change the active row set
while the user is scrolled away from the top, Tabulator's render window
can drift below the visible viewport — symptom: blank grid showing only
padding-top. Mitigations now in place:

- `applyFilters` uses `blockRedraw()` + `setFilter()` + `restoreRedraw()`
  + an explicit **`redraw(true)`** to force virtual-DOM offset recalculation.
- Every `replaceData()` call site is paired with `redraw(true)`.
- **`rowHeight: 33`** is locked in the constructor. Without it, subpixel
  per-row height variance from flex-laid-out cell formatters skews the
  upward-scroll padding estimate ("scroll up 2 rows, snap back 1").
- `logGridRenderState(label)` runs after every mutating operation and
  emits a loud warning when desync is detected.
- Console helpers: **`BSNZ.diagnoseGrid()`** and **`BSNZ.fixGrid()`**.

### BGG Mode toggle must call `redraw(true)`

`showColumn` / `hideColumn` do NOT re-run Tabulator's `fitColumns` layout
pass on their own — previously calculated widths stay frozen, leaving a
blank gap on the right when columns are hidden. The toggle handler calls
`table.redraw(true)` after flipping the visibility of every
`BGG_BASIC_COLUMNS` entry, which forces a layout recalculation; the
visible columns then expand to fill the container according to their
`widthGrow` ratios (TradeMe Listing=4, BGG Entry=2, Region=2).

### `[hidden]` override

`[hidden] { display: none !important; }` near the top of `app.css`. Without
it, `<div class="empty-state" hidden>` renders visibly because `display:
flex` beats the `hidden` attribute. The BGG sidebar section relies on this.

### BGG Mode toggle scope

`BGG_BASIC_COLUMNS = ['bgg_name', 'bgg_rank', 'bgg_average']` — toggled
together. Default ON. The button calls `table.showColumn(...)` /
`hideColumn(...)`, fires `redraw(true)`, and flips
`button.classList.toggle('primary', bggMode)`. `BGG_FULL_COLUMNS` (weight,
min_players, playing_time) stay invisible regardless of mode — they have
no data in csv-only builds.

### No persistent storage of listing data

Only one localStorage key on the website: `bsnz-hint-dismissed` for the
multi-sort hint banner. No IndexedDB on the website (the TM userscript
has its own — separate).

---
