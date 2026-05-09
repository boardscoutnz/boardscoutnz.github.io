'use strict';

// ==========================================================================
// 03-state.js — Module-scope mutable state + window.BSNZ console API (listings, bgg, table, mySorters, filters, bggMode)
// ==========================================================================

// ============================================================================
// 3. Module state
// ============================================================================

/** @type {Object[]}  All imported listings, after enrichment. */
let listings = [];

/**
 * BGG index. Built once when the cache loads, then never mutated.
 *
 * - games:               raw array from bgg-cache.json.
 * - byId:                Map<bggId, gameRecord>.
 * - byNormName:          Map<normalisedName, gameRecord> for the
 *                        fast-path full-string exact match.
 * - nameEntries:         Array<{id, normName, tokens, rank}>, one
 *                        entry per searchable name (primary + each
 *                        alt). Used by the token-containment matcher
 *                        in matchTitle().
 * - tokenToEntryIdx:     Map<token, Set<int>> — inverted index over
 *                        nameEntries. For each token, the set of
 *                        nameEntries indices whose name contains
 *                        that token. Lets the matcher narrow ~25k
 *                        candidates down to a handful of plausible
 *                        ones before doing the O(N) containment
 *                        check.
 * - fuse:                Fuse.js instance, used as the final fuzzy
 *                        fallback for typos.
 */
const bgg = {
  loaded: false,
  error: null,
  games: [],
  byId: new Map(),
  byNormName: new Map(),
  nameEntries: [],
  tokenToEntryIdx: new Map(),
  fuse: null,
};

/** Tabulator instance. */
let table = null;

/**
 * Authoritative multi-column sort state. Source of truth for both the call
 * to `table.setSort(...)` AND the priority badges painted into header
 * elements. Stored as `[{column, dir}, ...]` in priority order — index 0
 * is the primary sort, index 1 the tiebreaker, and so on.
 *
 * v1.6.4: ANY time mySorters crosses into Tabulator (via initialSort or
 * setSort) it MUST be deep-copied — `mySorters.map(s => ({column: s.column,
 * dir: s.dir}))` — never `mySorters.slice()`. Tabulator mutates the
 * `column` field of each sorter in place, resolving the string field name
 * to a ColumnComponent reference. With a shallow copy that mutation lands
 * on the very same objects mySorters still holds, after which
 * `mySorters[i].column` is no longer a string and every consumer of it
 * (findIndex(s => s.column === field), the badge-paint selector
 * [tabulator-field="${s.column}"], etc.) silently breaks.
 * *
 * v1.6.5: this whole append-on-shift-click custom handler is paired with
 * `sortOrderReverse: true` in the Tabulator constructor. With that flag
 * on, Tabulator interprets a sorter array as priority order (index 0 =
 * primary), which is what mySorters represents. Without the flag,
 * Tabulator interprets it as application order (last entry = primary),
 * and a setSort([primary, tiebreaker]) call renders the opposite of
 * intent. The flag and the custom handler are co-dependent: dropping
 * the flag silently inverts every multi-column sort, and dropping the
 * handler lets Tabulator's built-in unshift drive the array — which,
 * with the flag on, would make the most-recently-clicked column the
 * primary sort instead of a low-priority tiebreaker.
 */


let mySorters = [];

/**
 * Initial-setup guard. The post-construction setup (apply default
 * filters, install the sort handler, paint badges, refresh the stats
 * bar) must only run once even if `tableBuilt` happens to fire more
 * than once over the lifetime of the page. The flag is also useful as
 * a safety check in development — if something hits the setup path
 * before `tableBuilt`, this guard prevents a duplicate run later.
 */
let initialPostBuildSetupDone = false;

/** BGG Mode toggle state — see wireToolbarControls(). True at boot. */
let bggMode = true;

/** Active filter state. */
const filters = {
  // v1.6.x: top-level corpus split — listings are EITHER board games OR
  // expansions, never both. Default is 'board-games'. Toggled via the
  // segmented control in the topbar (#mode-toggle). v1.6.19 replaced the
  // previous Accessories mode with Expansions; accessory keywords were
  // moved into the userscript's PURGE_TITLE_RX so those listings are now
  // blacklisted upstream rather than partitioned.
  viewMode: 'board-games',                // 'board-games' | 'expansions'
  newListingsOnly: false,
  conditions: new Set(['new', 'used']),
  search: '',
  priceMin: null,
  priceMax: null,
  regions: new Set(),
  subcats: new Set(),
  hideUnranked: false,
  bggMaxRank: null,
  bggMaxWeight: null,
  bggMinRating: null,
  bggMinPlayers: null,
  bggMaxTime: null,
};

// Snapshot the filter state in a JSON-friendly shape (Sets become arrays)
// so we can pretty-print it to the console without crashing on circulars.
function filtersSnapshot() {
  return {
    viewMode:        filters.viewMode,
    newListingsOnly: filters.newListingsOnly,
    conditions:      [...filters.conditions],
    search:          filters.search,
    priceMin:        filters.priceMin,
    priceMax:        filters.priceMax,
    regions:         [...filters.regions],
    subcats:         [...filters.subcats],
    hideUnranked:    filters.hideUnranked,
    bggMaxRank:      filters.bggMaxRank,
    bggMaxWeight:    filters.bggMaxWeight,
    bggMinRating:    filters.bggMinRating,
    bggMinPlayers:   filters.bggMinPlayers,
    bggMaxTime:      filters.bggMaxTime,
  };
}

// ---- wire window.BSNZ -------------------------------------------------
// Now that the module-scope state exists we can hand getters out to the
// dev console. Each getter is a closure over the module-level binding
// so the value reflects the current state, not a snapshot taken at boot.

if (typeof window !== 'undefined') {
  Object.assign(window.BSNZ, {
    version:        APP_VERSION,
    getListings:    () => listings,
    getFilters:     () => filtersSnapshot(),
    getRawFilters:  () => filters,
    getSorters:     () => mySorters.slice(),
    getTable:       () => table,
    // v1.6.10: ad-hoc match tracer — call from the dev console to
    // see exactly which tier matched a title and why. Examples:
    //   BSNZ.matchTrace("Catan: Cities & Knights")
    //   BSNZ.matchTrace("Slay the Spire Board Game")
    //   BSNZ.matchTrace("Board games")
    // For each call it logs: the normalised form, the listing
    // tokens, every BGG nameEntry whose tokens are fully contained
    // in the listing (with their rank and contiguity flag), the
    // tier that won, and the final result object. Use this when an
    // accuracy issue is reported — you no longer have to guess
    // which tier produced a given match.
    matchTrace: (title) => {
      if (!bgg.loaded) {
        console.warn('[bsnz] matchTrace: BGG cache not loaded yet');
        return null;
      }
      const norm = normalizeTitle(title);
      const tokens = norm ? norm.split(' ').filter((t) => t.length > 0) : [];
      const tokenSet = new Set(tokens);
      console.group(`[bsnz] matchTrace("${title}")`);
      console.log('normalised:', JSON.stringify(norm));
      console.log('tokens:', tokens);
      const tier1 = bgg.byNormName.get(norm);
      console.log('Tier 1 (full exact) hit:', tier1 ? `id=${tier1.id} "${tier1.primaryName}" rank=${tier1.rank}` : 'no');
      const candidates = [];
      if (tokens.length >= 2) {
        const seen = new Set();
        for (const t of tokens) {
          const bucket = bgg.tokenToEntryIdx.get(t);
          if (bucket) for (const i of bucket) seen.add(i);
        }
        for (const i of seen) {
          const e = bgg.nameEntries[i];
          if (e.tokens.length < 2 || e.tokens.length > tokens.length) continue;
          if (!e.tokens.every((t) => tokenSet.has(t))) continue;
          candidates.push({
            id: e.id,
            primaryName: bgg.byId.get(e.id)?.primaryName || '(?)',
            normName: e.normName,
            tokens: e.tokens,
            nameLen: e.tokens.length,
            contiguous: norm.includes(e.normName),
            rank: e.rank,
          });
        }
        candidates.sort((a, b) =>
          b.nameLen - a.nameLen ||
          (Number(b.contiguous) - Number(a.contiguous)) ||
          a.rank - b.rank
        );
      }
      console.log(`Tier 2 (containment) candidates: ${candidates.length}`);
      if (candidates.length) console.table(candidates.slice(0, 10));
      const result = matchTitle(title);
      console.log('matchTitle() returned:', result);
      console.groupEnd();
      return result;
    },
    getBgg:         () => ({
      loaded: bgg.loaded,
      error: bgg.error,
      gameCount: bgg.games.length,
      byNormNameSize: bgg.byNormName.size,
      fuseReady: !!bgg.fuse,
    }),
    getState:       () => ({
      version: APP_VERSION,
      listingsCount: listings.length,
      tableExists: !!table,
      initialPostBuildSetupDone,
      bggMode,
      sorters: mySorters.slice(),
      filters: filtersSnapshot(),
      bgg: {
        loaded: bgg.loaded,
        error: bgg.error,
        gameCount: bgg.games.length,
      },
      debug: {
        enabled: isDebugEnabled(),
        categories: { ...(window.BSNZ_DEBUG_CATEGORIES || DEBUG_CATEGORIES) },
      },
    }),
    // v1.6.13: dump the grid's virtual-DOM render state to the
    // console as a readable table. Use this when the grid LOOKS
    // wrong (blank, frozen, missing rows) — it'll tell you whether
    // the issue is a scroll desync, a render failure, or something
    // else. Auto-runs the same desync checks as logGridRenderState.
    diagnoseGrid: () => {
      const tableEl = document.getElementById('grid');
      if (!tableEl) {
        console.warn('[bsnz] diagnoseGrid: #grid not found in DOM');
        return null;
      }
      const holder = tableEl.querySelector('.tabulator-tableholder');
      const innerTable = tableEl.querySelector('.tabulator-table');
      const renderedRows = tableEl.querySelectorAll('.tabulator-row');
      const state = {
        activeRowCount: table ? table.getDataCount('active') : null,
        totalRowCount: table ? table.getDataCount() : null,
        renderedRowCount: renderedRows.length,
        scrollTop: holder ? Math.round(holder.scrollTop) : null,
        scrollHeight: holder ? holder.scrollHeight : null,
        clientHeight: holder ? holder.clientHeight : null,
        paddingTop: innerTable ? Math.round(parseFloat(innerTable.style.paddingTop) || 0) : null,
        paddingBottom: innerTable ? Math.round(parseFloat(innerTable.style.paddingBottom) || 0) : null,
        tableInnerHeight: innerTable ? innerTable.clientHeight : null,
        sorters: mySorters.map((s) => `${s.column}:${s.dir}`).join(', ') || '(none)',
      };
      if (state.paddingTop != null && state.scrollTop != null && state.clientHeight != null &&
          state.paddingTop > state.scrollTop + state.clientHeight && state.renderedRowCount > 0) {
        state.diagnosis = '⚠️ SCROLL DESYNC — rendered rows are below the visible viewport. Run BSNZ.fixGrid() to recover.';
      } else if (state.activeRowCount > 0 && state.renderedRowCount === 0) {
        state.diagnosis = '⚠️ NO ROWS RENDERED — active row set is non-empty. Run BSNZ.fixGrid() to recover.';
      } else {
        state.diagnosis = 'OK';
      }
      console.table(state);
      return state;
    },

    // v1.6.13: forces the grid back into a known-good render state.
    // Pairs with diagnoseGrid(): if diagnose says SCROLL DESYNC or
    // NO ROWS RENDERED, fixGrid() is the recovery action.
    fixGrid: () => {
      if (!table) {
        console.warn('[bsnz] fixGrid: table not initialised yet');
        return;
      }
      console.log('[bsnz] fixGrid: forcing redraw(true) + scrollTop=0…');
      try {
        table.redraw(true);
        const tableEl = document.getElementById('grid');
        const holder = tableEl ? tableEl.querySelector('.tabulator-tableholder') : null;
        if (holder) holder.scrollTop = 0;
        console.log('[bsnz] fixGrid: done. Run BSNZ.diagnoseGrid() to verify.');
      } catch (e) {
        console.error('[bsnz] fixGrid threw:', e);
      }
    },
    enableDebug:    () => { window.BSNZ_DEBUG = true;  console.log('[bsnz] debug ENABLED'); },
    disableDebug:   () => { window.BSNZ_DEBUG = false; console.log('[bsnz] debug DISABLED'); },
    muteCategory:   (cat) => {
      if (!(cat in (window.BSNZ_DEBUG_CATEGORIES || {}))) {
        console.warn(`[bsnz] unknown category "${cat}" — known: ${Object.keys(DEBUG_CATEGORIES).join(', ')}`);
        return;
      }
      window.BSNZ_DEBUG_CATEGORIES[cat] = false;
      console.log(`[bsnz] muted category: ${cat}`);
    },
    unmuteCategory: (cat) => {
      if (!window.BSNZ_DEBUG_CATEGORIES) window.BSNZ_DEBUG_CATEGORIES = {};
      window.BSNZ_DEBUG_CATEGORIES[cat] = true;
      console.log(`[bsnz] unmuted category: ${cat}`);
    },
    help: () => {
      const cats = Object.keys(DEBUG_CATEGORIES).join(', ');
      console.log(
`Board Scout NZ — debug console API
==================================

Toggle:
BSNZ_DEBUG = true|false             — master debug switch
BSNZ_DEBUG_CATEGORIES.<cat> = bool  — toggle one category directly
BSNZ.muteCategory('<cat>')          — friendlier mute
BSNZ.unmuteCategory('<cat>')        — friendlier unmute
  (categories: ${cats})

State inspection:
BSNZ.getState()                     — one-shot snapshot of everything
BSNZ.getListings()                  — live listings array
BSNZ.getFilters()                   — JSON-safe snapshot of filter state
BSNZ.getRawFilters()                — live filter object (Sets are real Sets)
BSNZ.getSorters()                   — copy of the active mySorters array
BSNZ.getTable()                     — live Tabulator instance
BSNZ.getBgg()                       — BGG cache state summary
BSNZ.diagnoseGrid()                 — virtual-DOM render state + scroll-desync detection
BSNZ.fixGrid()                      — recover from scroll desync / blank grid

Other:
BSNZ.enableDebug()  / BSNZ.disableDebug()
BSNZ.help()                         — this message
BSNZ.version                        — app version string

Tip: filter the DevTools console for "[bsnz" to see only this app's logs,
or for "[<category>]" (e.g. "[sort]") to focus on one subsystem.`);
    },
  });
}
