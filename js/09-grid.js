'use strict';

// ==========================================================================
// 09-grid.js — buildColumns(), Tabulator constructor, tableBuilt/dataSorted handlers, BGG column visibility
// ==========================================================================

// ============================================================================
// 9. Tabulator initialization
//
// CRITICAL Tabulator 6.x detail (rediscovered in v1.6.3): in Tabulator
// 6.x, `tableBuilt` and `dataSorted` are **events**, not callbacks.
// They MUST be subscribed via `table.on("eventName", handler)` AFTER the
// constructor returns. Passing them as constructor options — the
// pre-6.x style — does NOT work; Tabulator 6.x silently ignores them
// and the handlers never fire.
//
// Symptom when this is broken (which is what v1.6.0 → v1.6.2 shipped
// with): on first page load the topbar stats stay stuck at "no data
// loaded", and the default filters are silently never applied.
// Touching any
// sidebar filter "fixes" the page because the sidebar handlers call
// applyFilters() directly, which in turn calls updateStatsBar(). The
// v1.6.1 microtask defer was a fix for the wrong problem — `tableBuilt`
// wasn't being fired late, it wasn't being fired at all.
//
// The fix in v1.6.3: build the Tabulator instance with NO `tableBuilt`
// or `dataSorted` keys in the options object, then immediately call
//     table.on("tableBuilt", ...)
//     table.on("dataSorted", ...)
// on the returned instance. Tabulator 6.0+ guarantees the `tableBuilt`
// event waits for the initial data load to complete and fires
// asynchronously, so by the time it fires the `table` global is
// already assigned — no microtask wrapper needed.
//
// See https://tabulator.info/docs/6.3/events for the canonical list of
// events vs. https://tabulator.info/docs/6.3/callbacks for callbacks.
// `rowFormatter` is a *callback* (it customises rendering and remains
// a constructor option), but anything purely notificational like
// tableBuilt / dataSorted / dataLoaded / dataFiltered / cellClick /
// rowClick is an *event* that must use `.on()`.
// ============================================================================

function showGrid() {
  dbg('tabulator', 'showGrid called');
  const empty = document.getElementById('empty-state');
  if (empty) empty.hidden = true;
  document.getElementById('grid-container').hidden = false;
  document.getElementById('btn-export-filtered').disabled = false;
  document.getElementById('btn-clear-sort').disabled = false;

  populateFilterDropdowns();

  if (table) {
    dbg('tabulator', 'showGrid: re-render path — table already exists, replaceData()');
    table.replaceData(listings).then(() => {
      dbg('tabulator', 'replaceData resolved — running redraw(true) then applying filters');
      table.redraw(true);   // v1.6.13: prevent virtual-DOM scroll desync (see applyFilters)
      applyFilters();
    });
    return;
  }

  // Seed our authoritative sort state with the same single-column sort
  // we hand to Tabulator's `initialSort`. From this point on, all sort
  // changes flow through our custom click handler (setupCustomSortHandler)
  // and `setSorters()` rather than Tabulator's built-in sort handling.
  mySorters = [{ column: 'price', dir: 'desc' }];
  dbg('sort', 'seeded mySorters:', mySorters.slice());

  dbg('tabulator', `constructing new Tabulator with ${listings.length.toLocaleString()} rows`);
  dbgTime('Tabulator constructor');
  table = new Tabulator('#grid', {
    data: listings,
    height: '100%',
    layout: 'fitColumns',
    virtualDom: true,
    virtualDomBuffer: 400,
    // v1.6.16: lock the row height to a known constant. Without this,
    // Tabulator measures rendered rows to estimate the heights of rows
    // it hasn't rendered yet — used for the padding-top/padding-bottom
    // arithmetic that positions unrendered rows. Subpixel differences
    // between rows (caused by display:flex in the .cell-title and
    // .cell-bgg formatters, plus variable BGG-name string widths
    // affecting line-box height) skew the estimate just enough that
    // scrolling UP — which is the only direction that has to *use*
    // the estimate — accumulates positional drift, manifesting as
    // "scroll up 2 rows, snap back 1". Down-scroll is unaffected
    // because it only ever appends rows whose heights are then
    // measured directly. With rowHeight set, the math is exact in
    // both directions.
    rowHeight: 33,
    placeholder: 'No listings match the current filters',
    // Apply this default to every column. `headerTooltip: true` tells
    // Tabulator to set the native browser `title` attribute on each
    // column header to the column's title text — so when the title is
    // ellipsis-truncated (which happens on narrow columns, especially
    // once the v1.6.7 priority badge claims its space at the left of
    // the title), hovering the header for ~1s shows the full title in
    // the OS-native tooltip. No CSS or DOM work; it's the standard
    // browser tooltip you'd get from any title="…" attribute. v1.6.7.
    columnDefaults: {
      headerTooltip: true,
    },
    columnHeaderSortMulti: true,
    // Tabulator interprets a setSort/initialSort array as "application
    // order" — sorts are applied left-to-right via stable sort, so the
    // LAST entry ends up as the primary visual sort and earlier entries
    // degrade into tiebreakers (https://tabulator.info/docs/6.3/sort).
    // `sortOrderReverse: true` flips that convention so array order
    // matches priority order (index 0 = primary, last = lowest-priority
    // tiebreaker), which is what mySorters already represents AND what
    // the numbered priority badges already advertise on the headers.
    // Without this flag, setSort([condition, price]) renders as
    // "price primary, condition tiebreaker" — the exact opposite
    // of intent — and the badges silently lie about which column is the
    // primary sort. v1.6.5.
    sortOrderReverse: true,
    initialSort: mySorters.map((s) => ({ column: s.column, dir: s.dir })),
    // rowFormatter is a *callback* (constructor option) — it customises
    // how each row is rendered, returns nothing, and remains a valid
    // constructor option in Tabulator 6.x.
    columns: buildColumns(),
    // NOTE: `tableBuilt` and `dataSorted` are NOT listed here. They are
    // events in Tabulator 6.x (not callbacks) and must be subscribed
    // via `.on()` below — see the §9 header comment for why.
  });
  dbgTimeEnd('Tabulator constructor');
  dbg('tabulator', 'Tabulator constructor returned — `table` global now assigned, attaching event listeners');

  // ---- tableBuilt: deferred initial setup -----------------------------
  //
  // Fires after Tabulator has finished constructing the table AND
  // populating it with data. This is the right moment to apply the
  // default filters (so the topbar stats reflect the real filtered
  // count), set up the custom sort click handler, and start the
  // sort-badge observer.
  //
  // Tabulator 6.0+ guarantees this event waits for the initial data
  // load to complete and fires asynchronously, so subscribing here
  // (after the constructor returns) is reliable; the `table` global
  // is guaranteed assigned by the time the handler runs.
  //
  // The `initialPostBuildSetupDone` guard is belt-and-braces: if the
  // event somehow fires more than once (e.g. after some future call
  // that rebuilds the table internally), we don't re-install the
  // capture-phase click handler twice or re-run the initial filter
  // pass.
  table.on('tableBuilt', () => {
    dbg('tabulator', `tableBuilt event fired — table.getDataCount=${table.getDataCount()}, active=${table.getDataCount('active')}`);
    if (initialPostBuildSetupDone) {
      dbg('tabulator', 'tableBuilt fired again after initial setup — skipping re-setup (this is fine)');
      return;
    }
    initialPostBuildSetupDone = true;
    applyFilters();
    setupCustomSortHandler();
    setupSortBadgeObserver();
    applySortBadges();   // initial pass — initialSort is a single col, so no badges expected
    dbg('tabulator', 'initial post-build setup complete (filters applied, custom sort handler wired, badge observer running)');
  });

  // ---- dataSorted: re-paint sort priority badges ----------------------
  //
  // Fires after every sort change (including the initial sort and our
  // own programmatic setSort calls). We re-apply badges eagerly so they
  // appear the moment a sort is applied; the MutationObserver in
  // setupSortBadgeObserver() is the safety net for any subsequent
  // header re-renders Tabulator does on its own.
  table.on('dataSorted', (sorters, rows) => {
    const sig = sorters.map((s) => `${s.field || (s.column && s.column.getField && s.column.getField())}:${s.dir}`).join(', ');
    dbg('tabulator', `dataSorted event: ${sorters.length} sorter(s) [${sig}], ${rows.length.toLocaleString()} active rows`);
    applySortBadges();
    // v1.6.13: sort changes can also desync the virtual-DOM render
    // window if the active row set changes during the sort. Log the
    // post-sort render state so a regression here is just as easy
    // to spot as a post-filter one.
    logGridRenderState('post-sort');
  });
}

function buildColumns() {
  return [
    {
      // v1.6.11: header renamed Title → "TradeMe Listing" to make
      // the column's source explicit now that "BGG Entry" sits next
      // to it. The underlying field is still `title` so search,
      // CSV export and sort state are unaffected.
      title: 'TradeMe Listing', field: 'title', widthGrow: 4, minWidth: 220, sorter: 'string',
      formatter: (cell) => {
        const d = cell.getRow().getData();
        const title = escapeHtml(d.title);
        const url = escapeAttr(d.url);
        // v1.6.13: red NEW badge for listings flagged isNewListing
        // by the userscript (i.e. first seen during the most recent
        // Quick Run). The badge sits BEFORE the title so it's
        // visible even when the title is truncated.
        const newBadge = d.isNewListing
          ? '<span class="badge-new" title="First seen in the most recent Quick Run">NEW</span> '
          : '';
        return `<div class="cell-title">
          ${newBadge}<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        </div>`;
      },
    },
    // v1.6.11: BGG Entry column. Renamed from "BGG", made visible by
    // default (BGG Mode is ON at startup), and widened to fit the
    // longer header plus a typical matched name. Each row shows the
    // match-confidence icon (green ✓ exact / blue ~ fuzzy /
    // orange ? uncertain) followed by the hyperlinked BGG primary
    // name. Clicking the name opens the corresponding BGG game page
    // in a new tab — primary mechanism for auditing match quality.
    {
      title: 'BGG Entry', field: 'bgg_name', widthGrow: 2, minWidth: 200,
      visible: true,
      sorter: (a, b) => (a || '').localeCompare(b || ''),
      formatter: (cell) => {
        const d = cell.getRow().getData();
        const conf = d.bgg_match_confidence || 'none';
        const iconCls = conf === 'exact' ? 'exact'
                     : conf === 'fuzzy' ? 'fuzzy'
                     : conf === 'uncertain' ? 'uncertain'
                     : 'none';
        const iconChar = conf === 'exact' ? '✓'
                      : conf === 'fuzzy' ? '~'
                      : conf === 'uncertain' ? '?'
                      : '';
        if (!d.bgg_id) {
          return `<div class="cell-bgg"><span class="match-icon ${iconCls}">${iconChar}</span><span class="muted">—</span></div>`;
        }
        const url = `https://boardgamegeek.com/boardgame/${d.bgg_id}`;
        const yr = d.bgg_year ? ` <span class="muted">(${d.bgg_year})</span>` : '';
        return `<div class="cell-bgg">
          <span class="match-icon ${iconCls}" title="${escapeAttr(conf)} match">${iconChar}</span>
          <a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.bgg_name)}</a>${yr}
        </div>`;
      },
    },
    {
      title: 'Price', field: 'price', width: 90, sorter: 'number', hozAlign: 'right',
      formatter: (cell) => {
        const v = cell.getValue();
        if (v == null) return '';
        return `$${v.toFixed(2)}`;
      },
    },
    {
      title: 'Sale', field: 'priceLabel', width: 115, sorter: 'string',
      formatter: (cell) => {
        const v = cell.getValue();
        return v ? escapeHtml(v) : '';
      },
    },
    {
      title: 'Cond.', field: 'condition', width: 85,
      formatter: (cell) => {
        const v = cell.getValue();
        if (!v || v === 'unknown') return '';
        const cls = v === 'new' ? 'new' : 'used';
        const label = v === 'new' ? 'New' : 'Used';
        return `<span class="condition-pill ${cls}">${label}</span>`;
      },
    },
    {
      title: 'Region', field: 'regionDisplay', widthGrow: 2, minWidth: 130, sorter: 'string',
    },
    // All BGG-derived columns below are hidden by default — see
    // BGG_COLUMN_FIELDS at the top of the file. The disabled
    // "Show BGG columns" topbar button advertises that the BGG
    // pipeline isn't wired up yet.
    {
      // Visible by default — BGG Mode is ON at startup. Toggling the
      // BGG Mode button in the topbar hides/shows this column along
      // with bgg_average. See BGG_BASIC_COLUMNS in §2.
      title: 'BGG Rank', field: 'bgg_rank', width: 115, hozAlign: 'right',
      visible: true,
      // v1.6.10: custom sorter — direction-aware null handling.
      // Rationale: Tabulator's built-in 'number' sorter leaves null
      // values wherever the browser's sort happens to put them, so
      // unranked listings (bgg_rank == null because the listing
      // didn't match anything in the rankings file) appeared above
      // ranked listings sometimes and below other times. This
      // sorter forces nulls to the BOTTOM regardless of direction:
      // ascending → 1, 2, …, N, [unranked, unranked]; descending →
      // N, …, 2, 1, [unranked, unranked]. The dir argument is
      // supplied by Tabulator 6.x, see
      // https://tabulator.info/docs/6.3/sort#func-custom.
      sorter: (a, b, _aRow, _bRow, _column, dir) => {
        const aMissing = a == null;
        const bMissing = b == null;
        if (aMissing && bMissing) return 0;
        // Tabulator inverts the sorter result when dir==='desc'. To
        // park missing values at the bottom in BOTH directions, we
        // return a sign that — once Tabulator does its potential
        // inversion — still places the missing row last.
        if (aMissing) return dir === 'desc' ? -1 : 1;
        if (bMissing) return dir === 'desc' ? 1 : -1;
        return a - b;
      },
      // v1.6.10: display cap is now driven by bgg.games.length —
      // i.e. the actual number of entries in bgg-rankings.json — not
      // a hardcoded constant. Rebuild the rankings file with 5,000
      // entries and the badge automatically reads ">5,000"; rebuild
      // with 50,000 and it reads ">50,000". The badge is shown ONLY
      // when bgg_rank is null (the listing is unmatched). A matched
      // listing whose rank is, say, 14,873 displays "14,873" — there
      // is no longer an arbitrary cutoff above which a real rank
      // gets hidden behind a badge.
      formatter: (cell) => {
        const v = cell.getValue();
        if (v != null) return v.toLocaleString();
        const cap = (bgg && bgg.games && bgg.games.length) ? bgg.games.length : 0;
        if (!cap) return '<span class="muted">—</span>';
        return `<span class="badge-unranked" title="No BGG match — outside the top ${cap.toLocaleString()} games in the rankings file, or no match was found at all">&gt;${cap.toLocaleString()}</span>`;
      },
    },
    {
      // Visible by default — see comment on bgg_rank above.
      title: 'BGG Rating', field: 'bgg_average', width: 115, sorter: 'number', hozAlign: 'right',
      visible: true,
      formatter: (cell) => {
        const v = cell.getValue();
        return v == null ? '<span class="muted">—</span>' : v.toFixed(1);
      },
    },
    {
      title: 'Weight', field: 'bgg_weight', width: 75, sorter: 'number', hozAlign: 'right',
      visible: false,
      formatter: (cell) => {
        const v = cell.getValue();
        return v == null ? '<span class="muted">—</span>' : v.toFixed(1);
      },
    },
    {
      title: 'Players', field: 'bgg_min_players', width: 80, sorter: 'number',
      visible: false,
      formatter: (cell) => {
        const d = cell.getRow().getData();
        if (d.bgg_min_players == null && d.bgg_max_players == null) {
          return '<span class="muted">—</span>';
        }
        if (d.bgg_min_players === d.bgg_max_players) return `${d.bgg_min_players}`;
        return `${d.bgg_min_players ?? '?'}–${d.bgg_max_players ?? '?'}`;
      },
    },
    {
      title: 'Time', field: 'bgg_playing_time', width: 70, sorter: 'number', hozAlign: 'right',
      visible: false,
      formatter: (cell) => {
        const v = cell.getValue();
        return v == null ? '<span class="muted">—</span>' : `${v}m`;
      },
    },
  ];
}


