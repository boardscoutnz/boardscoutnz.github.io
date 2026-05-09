'use strict';

/* =============================================================================
 * Board Scout NZ — app.js (master file)
 *
 * This file is a slim PARENT / TABLE-OF-CONTENTS for the website code.
 * The actual implementation is split across the files in ./js/, each of
 * which is loaded by `<script defer>` tags in index.html in the order
 * listed below. Loading order matters — top-level `let`/`const`/`function`
 * declarations in classic scripts share a single document-wide scope, and
 * earlier scripts must finish before later scripts execute.
 *
 * Why this structure exists
 * -------------------------
 * Going forward, when a bug needs fixing or a feature needs adding, only
 * the affected child file should need to be regenerated — keeping
 * round-trips and token usage small. Adding a NEW cohort of functionality
 * is a 3-step ritual: (1) create js/NN-name.js with the new code,
 * (2) run `bash components/build.sh` (it globs js/*.js and emits the
 * <script defer> tags for you), (3) add a one-line entry to the Module
 * map below.
 *
 * Why no IIFE wrapper / no ES modules
 * -----------------------------------
 * Originally app.js was one ~2950-line IIFE so that all module-private
 * state (listings, bgg, table, mySorters, …) sat inside a single closure.
 * Splitting that IIFE while keeping cross-section function calls working
 * was achieved the simplest possible way: each child file is a plain
 * classic script. Top-level `let`/`const`/`function` in classic scripts
 * already share one document-wide lexical scope (NOT attached to
 * `window`), so the public surface is the same as before. The only
 * intentional `window.*` exports are `window.BSNZ_DEBUG` /
 * `window.BSNZ_DEBUG_CATEGORIES` / `window.BSNZ` — the runtime debug API
 * — wired up from 01-debug.js + 03-state.js.
 *
 * Module map (load order)
 * -----------------------
 *
 *   js/01-debug.js
 *     Debug logging (DEBUG flag, DEBUG_CATEGORIES, dbg/dbgWarn/dbgError/
 *     dbgGroup/dbgTime helpers, BSNZ_DEBUG runtime toggles, the empty
 *     window.BSNZ stub object that 03-state.js fills in later).
 *
 *   js/02-config.js
 *     All compile-time constants and tuning knobs:
 *       APP_VERSION, BGG_RANKINGS_URL, LISTINGS_URL, RANK_THRESHOLD,
 *       MATCH_BATCH_SIZE, FUSE_TOP_N_LIMIT, MATCH_SLOW_LISTING_MS,
 *       SENTINEL_REPLACEMENTS, MIN_SINGLE_TOKEN_LEN, SUBCAT_LABELS +
 *       subcatLabel(), NOISE_TOKENS, regex helpers (PUNCT_RX, QTY_RX,
 *       YEAR_RX, MULTISP), FUSE_THRESHOLD, UNCERTAIN_GAP,
 *       MIN_SORTERS_FOR_BADGES, BGG_BASIC_COLUMNS, BGG_FULL_COLUMNS.
 *     ANY new constant or matching knob goes here.
 *
 *   js/03-state.js
 *     Module-scope mutable state — the live working set of the app:
 *       listings[], bgg{}, table, mySorters[], initialPostBuildSetupDone,
 *       bggMode, filters{}, filtersSnapshot().
 *     ALSO contains the Object.assign(window.BSNZ, …) block that wires
 *     the runtime debug console API (BSNZ.matchTrace, BSNZ.diagnoseGrid,
 *     BSNZ.fixGrid, BSNZ.getState, BSNZ.help, …).
 *
 *   js/04-bootstrap.js
 *     The DOMContentLoaded handler. Sets the version pill, calls the four
 *     wire*() functions, schedules the data-meta pill auto-refresh, then
 *     kicks off the BGG cache + listings.json fetch.
 *
 *   js/05-bgg-cache.js
 *     loadBggCache(): fetches data/bgg-rankings.json and builds the
 *     matching index (bgg.byId, bgg.byNormName, bgg.nameEntries,
 *     bgg.tokenToEntryIdx, optional bgg.fuse). Updates the BGG status
 *     pill in the sidebar.
 *
 *   js/06-matching.js
 *     The BGG title-matching pipeline:
 *       normalizeTitle()         — sentinel + noise + punctuation strip
 *       findPositionInListing()  — earliest-position / contiguity helper
 *       matchTitle()             — Tier 1 (exact) → Tier 2 (token
 *                                  containment + position scoring) →
 *                                  Tier 3 (Fuse, currently disabled)
 *       enrichListingsWithBgg()  — async batched enrichment loop
 *
 *   js/07-ingestion.js
 *     loadListings() / ingestJson(): fetches data/listings.json,
 *     normalises both the new wrapper shape and the legacy bare-array
 *     shape, populates the `listings` array, kicks off enrichment, and
 *     calls showGrid() so the grid appears before BGG enrichment finishes.
 *     Also owns the empty-state UI when fetch fails.
 *
 *   js/08-data-pill.js
 *     The topbar "Data updated 3d ago" pill. setDataMetaFromExportedAt(),
 *     refreshDataMetaPillRelative() — green→orange→red age states.
 *
 *   js/09-grid.js
 *     buildColumns(): the Tabulator column definitions (TM Listing, BGG
 *     Entry, Price, Sale, Cond, Region, BGG Rank, BGG Rating, hidden
 *     Weight/Players/Time). showGrid(): instantiates Tabulator, attaches
 *     tableBuilt + dataSorted event handlers, runs initial-setup-once.
 *
 *   js/10-sort.js
 *     The capture-phase header-click interceptor that drives mySorters[].
 *     Plain click → replace; shift-click on new col → append; shift-click
 *     on existing col → toggle direction. Called from inside tableBuilt.
 *
 *   js/11-sort-badges.js
 *     paintSortBadges(): renders the numbered priority pills on column
 *     headers when mySorters.length >= MIN_SORTERS_FOR_BADGES (= 2).
 *     Plus the MutationObserver scoped to .tabulator-header that
 *     re-applies badges after Tabulator redraws the header.
 *
 *   js/12-filters.js
 *     The whole sidebar filter system in one file:
 *       wireFilterControls()        — DOM event wiring for every input
 *       passesFilters(row, opts)    — single source of truth predicate
 *       computeFacetCounts()        — cross-facet counts {regions, subcats}
 *       refreshFacetCounts()        — updates the (N) spans in place
 *       populateFilterDropdowns()   — builds region + subcat checkboxes
 *       resetFilters()              — restore defaults
 *       toggleSet(), logGridRenderState()
 *       applyFilters()              — the chokepoint that re-runs the
 *                                     predicate against the grid
 *
 *   js/13-toolbar.js
 *     wireToolbarControls(): BGG Mode toggle button, "Export filtered
 *     CSV", "Clear sort". Plus updateStatsBar() (the topbar "X listings,
 *     Y filtered" pill) and exportFilteredCsv().
 *
 *   js/14-help.js
 *     wireHelpModal() and wireGridHint(): the About modal (?), the
 *     yellow first-time multi-sort hint banner above the grid, and its
 *     localStorage 'bsnz-hint-dismissed' flag.
 *
 *   js/15-utils.js
 *     Tiny reusable helpers used across modules: showToast(),
 *     escapeHtml(), escapeAttr(), debounce(). If a helper is used in
 *     more than one module, it goes here.
 *
 * Adding a new file
 * -----------------
 * 1. Create js/NN-name.js (pick the next free NN — gaps are fine, it's
 *    just for sort order). Top of file: `'use strict';` + a banner
 *    comment with the same one-paragraph blurb you'd add to this map.
 * 2. Run `bash components/build.sh`. The build script globs js/*.js and
 *    emits the <script defer> tags for you (with app.js forced last) —
 *    no manual edit of index.html needed.
 * 3. Add a corresponding entry to the "Module map" block above.
 *
 * Conventions
 * -----------
 * • Top-level declarations in child files are NOT attached to `window`
 *   (classic scripts give them lexical-but-shared scope). Don't introduce
 *   `var` at the top level — it would leak to `window` and is not needed.
 * • Cross-module references are by name (e.g. `applyFilters` from
 *   12-filters.js is called by name from 13-toolbar.js). No imports.
 * • Functions hoist within a script; closures capturing names defined in
 *   later-loaded scripts work because they only resolve those names at
 *   call time, by which point all scripts have finished evaluating.
 * • If you need to know whether everything's loaded, check
 *   `typeof <fn> === 'function'` at runtime, not at script eval time.
 * ============================================================================ */

// Sanity check: confirm every expected child module has had a chance to
// register its key entry-points. If any of these are undefined at this
// point, a <script> tag is missing or out of order in index.html.
// This block is harmless if everything is fine; it'll print one
// diagnostic line and a warning if anything is broken.
(function masterFileSanityCheck() {
  // app.js is loaded LAST (after every js/NN-*.js), so by this point all
  // top-level declarations should be in scope.
  const required = [
    'APP_VERSION',         // 02-config.js
    'listings',            // 03-state.js
    'loadBggCache',        // 05-bgg-cache.js
    'matchTitle',          // 06-matching.js
    'loadListings',        // 07-ingestion.js
    'showGrid',            // 09-grid.js
    'applyFilters',        // 12-filters.js
    'wireToolbarControls', // 13-toolbar.js
    'showToast',           // 15-utils.js
  ];
  const missing = [];
  for (const name of required) {
    try {
      // eslint-disable-next-line no-eval
      if (typeof eval(name) === 'undefined') missing.push(name);
    } catch (_) {
      missing.push(name);
    }
  }
  if (missing.length === 0) {
    if (typeof dbg === 'function') {
      dbg('init', `app.js (master) — all ${required.length} required modules present`);
    }
  } else {
    console.error(
      '[bsnz] app.js master sanity check FAILED — missing:',
      missing,
      '\nCheck that every js/NN-*.js script tag is present in index.html and in the right order.'
    );
  }
})();
