'use strict';

// ==========================================================================
// 12-filters.js — passesFilters, applyFilters, buildFacets, computeFacetCounts, refreshFacetCounts, sidebar event wiring, mode toggle
// ==========================================================================

// ============================================================================
// 12. Filter UI wiring
// ============================================================================

function wireFilterControls() {
  const debouncedApply = debounce(() => {
    dbg('filter', 'debounced applyFilters firing');
    applyFilters();
  }, 150);

  const cbNew  = document.getElementById('f-cond-new');
  const cbUsed = document.getElementById('f-cond-used');
  cbNew.addEventListener('change', () => {
    dbg('filter', `[event] Condition: New → ${cbNew.checked ? 'CHECKED' : 'UNCHECKED'}`);
    toggleSet(filters.conditions, 'new', cbNew.checked);
    applyFilters();
  });
  cbUsed.addEventListener('change', () => {
    dbg('filter', `[event] Condition: Used → ${cbUsed.checked ? 'CHECKED' : 'UNCHECKED'}`);
    toggleSet(filters.conditions, 'used', cbUsed.checked);
    applyFilters();
  });

  document.getElementById('f-search').addEventListener('input', (e) => {
    const v = (e.target.value || '').trim().toLowerCase();
    dbg('filter', `[event] search input → "${v}"`);
    filters.search = v;
    debouncedApply();
  });

  document.getElementById('f-pmin').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] price min → ${v}`);
    filters.priceMin = v;
    debouncedApply();
  });
  document.getElementById('f-pmax').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] price max → ${v}`);
    filters.priceMax = v;
    debouncedApply();
  });

  document.getElementById('f-region').addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    const div = document.getElementById('f-region');
    filters.regions = new Set(
      Array.from(div.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value)
    );
    dbg('filter', `[event] region toggle (${e.target.value} → ${e.target.checked}); regions now:`, [...filters.regions]);
    applyFilters();
  });
  document.getElementById('f-subcat').addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    const div = document.getElementById('f-subcat');
    filters.subcats = new Set(
      Array.from(div.querySelectorAll('input[type="checkbox"]:checked')).map((i) => i.value)
    );
    dbg('filter', `[event] subcat toggle (${e.target.value} → ${e.target.checked}); subcats now:`, [...filters.subcats]);
    applyFilters();
  });

  document.getElementById('f-hide-unranked').addEventListener('change', (e) => {
    dbg('filter', `[event] hideUnranked → ${e.target.checked}`);
    filters.hideUnranked = e.target.checked;
    applyFilters();
  });
  document.getElementById('f-bgg-rank').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] bggMaxRank → ${v}`);
    filters.bggMaxRank = v;
    debouncedApply();
  });
  document.getElementById('f-bgg-weight').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] bggMaxWeight → ${v}`);
    filters.bggMaxWeight = v;
    debouncedApply();
  });
  document.getElementById('f-bgg-rating').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] bggMinRating → ${v}`);
    filters.bggMinRating = v;
    debouncedApply();
  });
  document.getElementById('f-bgg-players').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] bggMinPlayers → ${v}`);
    filters.bggMinPlayers = v;
    debouncedApply();
  });
  document.getElementById('f-bgg-time').addEventListener('input', (e) => {
    const v = num(e.target.value);
    dbg('filter', `[event] bggMaxTime → ${v}`);
    filters.bggMaxTime = v;
    debouncedApply();
  });

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    dbg('ui', '[event] Reset filters button clicked');
    resetFilters();
  });

  const btnNewOnly = document.getElementById('btn-toggle-new-only');
  if (btnNewOnly) {
    btnNewOnly.addEventListener('click', () => {
      filters.newListingsOnly = !filters.newListingsOnly;
      btnNewOnly.classList.toggle('active', filters.newListingsOnly);
      btnNewOnly.setAttribute('aria-pressed', filters.newListingsOnly ? 'true' : 'false');
      btnNewOnly.textContent = filters.newListingsOnly
        ? 'Show <span class=".bold">ALL</span> Listings'
        : '<span class=".bold">NEW</span> Listings only';
      dbg('filter', `[event] newListingsOnly → ${filters.newListingsOnly}`);
      applyFilters();
    });
  }

  dbg('init', 'wireFilterControls: all filter event listeners attached');
}

function toggleSet(set, value, on) {
  if (on) set.add(value);
  else set.delete(value);
}

/**
 * Single source of truth for "does this row pass the active filter
 * configuration?" Used by:
 *   - applyFilters()       — the live grid filter
 *   - computeFacetCounts() — live region / sub-category counts in the sidebar
 *
 * Options:
 *   excludeRegions / excludeSubcats — skip the regions or subcats clause
 *     (used when counting facets, so a facet's OWN selections never
 *     affect its OWN numbers; only the OTHER filters do)
 *   onReject — optional callback invoked with the name of the FIRST
 *     failing clause, feeding the rejection-breakdown debug log
 *
 * Keep clause order aligned with applyFilters' historical order — the
 * rejection-breakdown semantics (first failing clause per row) rely
 * on it.
 */
function passesFilters(row, opts = {}) {
  const { excludeRegions = false, excludeSubcats = false,
          onReject = null } = opts;
  const reject = (clause) => { if (onReject) onReject(clause); return false; };

  if (filters.viewMode === 'board-games' && row.isExpansion)  return reject('viewMode');
  if (filters.viewMode === 'expansions'  && !row.isExpansion) return reject('viewMode');

  if (filters.newListingsOnly && !row.isNewListing) return reject('newListingsOnly');

  if (filters.conditions.size < 2 && !filters.conditions.has(row.condition)) return reject('condition');

  if (filters.search) {
    const haystack = `${row.title || ''} ${row.bgg_name || ''}`.toLowerCase();
    if (!haystack.includes(filters.search)) return reject('search');
  }

  if (filters.priceMin != null && (row.price == null || row.price < filters.priceMin)) return reject('priceMin');
  if (filters.priceMax != null && (row.price == null || row.price > filters.priceMax)) return reject('priceMax');

  if (!excludeRegions && filters.regions.size > 0 && !filters.regions.has(row.region)) return reject('region');
  if (!excludeSubcats && filters.subcats.size > 0 && !filters.subcats.has(row.subcat)) return reject('subcat');

  // v1.6.10: "unranked" now strictly means "no BGG match found".
  // Listings that match a BGG entry are always considered ranked,
  // regardless of where in the rankings file the match sits.
  if (filters.hideUnranked) {
    if (!row.bgg_id) return reject('unranked');
  }
  if (filters.bggMaxRank   != null && (row.bgg_rank == null || row.bgg_rank > filters.bggMaxRank)) return reject('bggMaxRank');
  if (filters.bggMaxWeight != null && (row.bgg_weight == null || row.bgg_weight > filters.bggMaxWeight)) return reject('bggMaxWeight');
  if (filters.bggMinRating != null && (row.bgg_average == null || row.bgg_average < filters.bggMinRating)) return reject('bggMinRating');
  if (filters.bggMinPlayers != null) {
    if (row.bgg_max_players == null || row.bgg_max_players < filters.bggMinPlayers) return reject('bggMinPlayers');
    if (row.bgg_min_players != null && row.bgg_min_players > filters.bggMinPlayers) return reject('bggMinPlayers');
  }
  if (filters.bggMaxTime != null && (row.bgg_playing_time == null || row.bgg_playing_time > filters.bggMaxTime)) return reject('bggMaxTime');

  return true;
}

/**
 * Tally per-region and per-subcategory listing counts for the sidebar
 * facets, applying every active filter EXCEPT each facet's OWN
 * selections. This gives "cross-facet" numbers:
 *   - Toggling Condition / Buy Now / Search / etc. updates BOTH counts
 *   - Selecting a region updates SUB-CATEGORY counts (not regions)
 *   - Selecting a sub-category updates REGION counts (not subcats)
 */
function computeFacetCounts() {

  const regionCounts = new Map();
  const subcatCounts = new Map();
  for (const l of listings) {
    if (passesFilters(l, { excludeRegions: true })) {
      if (l.region) regionCounts.set(l.region, (regionCounts.get(l.region) || 0) + 1);
    }
    if (passesFilters(l, { excludeSubcats: true })) {
      if (l.subcat) subcatCounts.set(l.subcat, (subcatCounts.get(l.subcat) || 0) + 1);
    }
  }
  return { regionCounts, subcatCounts };
}

/**
 * Update the "(N)" count next to each region & sub-category checkbox
 * in place, without rebuilding the DOM — so the user's checked state
 * (and any open scroll position) is preserved. Called once at the
 * tail of every applyFilters() invocation.
 */
function refreshFacetCounts() {
  const { regionCounts, subcatCounts } = computeFacetCounts();

  document.querySelectorAll('#f-region .multi-check-item').forEach((label) => {
    const cb   = label.querySelector('input[type="checkbox"]');
    const span = label.querySelector('.muted');
    if (!cb || !span) return;
    const n = regionCounts.get(cb.value) || 0;
    span.textContent = `(${n.toLocaleString()})`;
  });
  document.querySelectorAll('#f-subcat .multi-check-item').forEach((label) => {
    const cb   = label.querySelector('input[type="checkbox"]');
    const span = label.querySelector('.muted');
    if (!cb || !span) return;
    const n = subcatCounts.get(cb.value) || 0;
    span.textContent = `(${n.toLocaleString()})`;
  });
}

function populateFilterDropdowns() {
  const regionDiv = document.getElementById('f-region');
  const subcatDiv = document.getElementById('f-subcat');

  // OPTION SET = every region/subcat that has at least one listing in
  // the current view-mode corpus (board-games vs accessories). This
  // determines which checkboxes appear. It changes only when the
  // mode toggle flips — NOT on other filter changes — so options
  // whose dynamic count drops to 0 still appear with "(0)".
  //
  // COUNTS shown next to each option come from computeFacetCounts(),
  // which respects the cross-facet rule (region counts ignore the
  // regions selection; subcat counts ignore the subcats selection).
  const inMode = (l) => (filters.viewMode === 'expansions')
    ? !!l.isExpansion
    :  !l.isExpansion;
  const allRegions = new Set();
  const allSubcats = new Set();
  for (const l of listings) {
    if (!inMode(l)) continue;
    if (l.region) allRegions.add(l.region);
    if (l.subcat) allSubcats.add(l.subcat);
  }

  const { regionCounts, subcatCounts } = computeFacetCounts();

  const regions = [...allRegions].sort();
  const subcats = [...allSubcats]
    .sort((a, b) => subcatLabel(a).localeCompare(subcatLabel(b)));

  dbg('init', `populateFilterDropdowns: ${regions.length} region(s), ${subcats.length} subcat(s)`);
  dbg('init', 'regions:', regions.map((r) => `${r} (${regionCounts.get(r) || 0})`));
  dbg('init', 'subcats:', subcats.map((s) => `${s} → "${subcatLabel(s)}" (${subcatCounts.get(s) || 0})`));

  regionDiv.innerHTML = regions.length
    ? regions.map((r) => {
        const checked = filters.regions.has(r) ? ' checked' : '';
        return `<label class="multi-check-item">
           <input type="checkbox" value="${escapeAttr(r)}"${checked} />
           <span>${escapeHtml(r)} <span class="muted">(${(regionCounts.get(r) || 0).toLocaleString()})</span></span>
         </label>`;
      }).join('')
    : '<div class="multi-check-empty">No regions in data</div>';

  subcatDiv.innerHTML = subcats.length
    ? subcats.map((s) => {
        const checked = filters.subcats.has(s) ? ' checked' : '';
        return `<label class="multi-check-item">
           <input type="checkbox" value="${escapeAttr(s)}"${checked} />
           <span>${escapeHtml(subcatLabel(s))} <span class="muted">(${(subcatCounts.get(s) || 0).toLocaleString()})</span></span>
         </label>`;
      }).join('')
    : '<div class="multi-check-empty">No sub-categories in data</div>';
}

function resetFilters() {
  dbgGroup('filter', 'resetFilters');
  dbg('filter', 'state BEFORE reset:', filtersSnapshot());

  filters.viewMode = 'board-games';
  const btnModeBg  = document.getElementById('btn-mode-boardgames');
  const btnModeExp = document.getElementById('btn-mode-expansions');
  if (btnModeBg)  { btnModeBg.classList.add('active');     btnModeBg.setAttribute('aria-selected',  'true');  }
  if (btnModeExp) { btnModeExp.classList.remove('active'); btnModeExp.setAttribute('aria-selected', 'false'); }
  populateFilterDropdowns();    // re-render with board-games corpus
  filters.conditions = new Set(['new', 'used']);
  filters.newListingsOnly = false;
  const btnNewOnlyReset = document.getElementById('btn-toggle-new-only');
  if (btnNewOnlyReset) {
    btnNewOnlyReset.classList.remove('active');
    btnNewOnlyReset.setAttribute('aria-pressed', 'false');
    btnNewOnlyReset.textContent = '<span class=".bold">NEW</span> Listings only';
  }
  filters.search = '';
  filters.priceMin = null;
  filters.priceMax = null;
  filters.regions = new Set();
  filters.subcats = new Set();
  filters.hideUnranked = false;
  filters.bggMaxRank = null;
  filters.bggMaxWeight = null;
  filters.bggMinRating = null;
  filters.bggMinPlayers = null;
  filters.bggMaxTime = null;

  document.getElementById('f-cond-new').checked = true;
  document.getElementById('f-cond-used').checked = true;
  document.getElementById('f-search').value = '';
  document.getElementById('f-pmin').value = '';
  document.getElementById('f-pmax').value = '';
  document.querySelectorAll('#f-region input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  document.querySelectorAll('#f-subcat input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  document.getElementById('f-hide-unranked').checked = false;
  document.getElementById('f-bgg-rank').value = '';
  document.getElementById('f-bgg-weight').value = '';
  document.getElementById('f-bgg-rating').value = '';
  document.getElementById('f-bgg-players').value = '';
  document.getElementById('f-bgg-time').value = '';

  dbg('filter', 'state AFTER reset:', filtersSnapshot());
  dbgGroupEnd('filter');
  applyFilters();
}

// v1.6.13: dumps the grid's virtual-DOM render state. Called at the
// tail of applyFilters() and any other operation that mutates the
// active row set. The auto-detection at the bottom is the killer
// feature: a "scroll desync" (rendered rows positioned far below
// the user's actual scroll position) shows up as a single loud
// warning line in the console rather than a silently-blank grid.
//
// Read the output like this:
//   scrollTop / scrollHeight (clientHeight=…)
//     where Tabulator's tableholder thinks the user is, vs. how
//     much there is to scroll, vs. how tall the visible window is.
//   padTop / padBot
//     the virtual-DOM padding that positions the rendered rows
//     within the scrollable area. padTop > scrollTop + clientHeight
//     means the rendered rows are BELOW the visible viewport.
//   renderedRows
//     how many .tabulator-row DOM nodes actually exist. With
//     virtualDom:true this is normally a few dozen — never the full
//     dataset.
function logGridRenderState(label) {
  if (!isDebugEnabled() || !isCatEnabled('tabulator')) return;
  try {
    const tableEl = document.getElementById('grid');
    if (!tableEl) {
      dbgWarn('tabulator', `logGridRenderState(${label}): #grid not found`);
      return;
    }
    const holder = tableEl.querySelector('.tabulator-tableholder');
    const innerTable = tableEl.querySelector('.tabulator-table');
    const scrollTop = holder ? Math.round(holder.scrollTop) : null;
    const scrollHeight = holder ? holder.scrollHeight : null;
    const clientHeight = holder ? holder.clientHeight : null;
    const padTop = innerTable ? Math.round(parseFloat(innerTable.style.paddingTop) || 0) : null;
    const padBot = innerTable ? Math.round(parseFloat(innerTable.style.paddingBottom) || 0) : null;
    const renderedRows = tableEl.querySelectorAll('.tabulator-row').length;
    const activeCount = table ? table.getDataCount('active') : null;
    dbg('tabulator', `render state (${label}): activeRows=${activeCount}, renderedRows=${renderedRows}, scrollTop=${scrollTop}/${scrollHeight} (viewport=${clientHeight}), padTop=${padTop}, padBot=${padBot}`);

    // Auto-detect the scroll-desync condition. The signature is:
    // padTop is much larger than scrollTop, AND there are rendered
    // rows. That means the rendered window is sitting below the
    // visible viewport.
    if (padTop != null && scrollTop != null && clientHeight != null &&
        padTop > scrollTop + clientHeight && renderedRows > 0) {
      dbgWarn('tabulator',
        `⚠️ VIRTUAL-DOM SCROLL DESYNC DETECTED (${label}): rendered ` +
        `rows start at y=${padTop}px, but visible viewport ends at ` +
        `y=${scrollTop + clientHeight}px. The user is looking at ` +
        `${padTop - scrollTop - clientHeight}px of empty padding. ` +
        `Run BSNZ.fixGrid() in the console to recover, or call ` +
        `table.redraw(true) directly. If this fires unprompted, a ` +
        `data-mutation site (setFilter / replaceData / setSort) is ` +
        `missing its redraw(true) safeguard.`);
    }

    // Secondary check: active rows exist but nothing is rendered.
    // Different failure mode (e.g. a sizing issue) but worth flagging.
    if (activeCount > 0 && renderedRows === 0) {
      dbgWarn('tabulator',
        `⚠️ NO ROWS RENDERED (${label}) despite activeRows=${activeCount}. ` +
        `Run BSNZ.fixGrid() to recover.`);
    }
  } catch (e) {
    dbgWarn('tabulator', `logGridRenderState(${label}) threw:`, e && e.message);
  }
}

function applyFilters() {
  dbgGroup('filter', 'applyFilters');
  if (!table) {
    dbgWarn('filter', 'applyFilters called before `table` is ready — bailing');
    dbgGroupEnd('filter');
    return;
  }

  dbg('filter', 'current filter state:', filtersSnapshot());

  // Per-clause rejection counters — useful for debugging "why is my
  // grid empty / smaller than I expected". Each rejected row
  // increments exactly one counter (the FIRST clause it failed); the
  // counters always sum to (totalListings - visible).
  const rejectedBy = {
    viewMode: 0, newListingsOnly: 0, condition: 0, search: 0,
    priceMin: 0, priceMax: 0, region: 0, subcat: 0,
    unranked: 0, bggMaxRank: 0, bggMaxWeight: 0, bggMinRating: 0,
    bggMinPlayers: 0, bggMaxTime: 0,
  };

  // v1.6.13: filter application is now wrapped in
  // blockRedraw/restoreRedraw + an explicit redraw(true).
  //
  //   blockRedraw() / restoreRedraw() — coalesces the intermediate
  //   redraws that setFilter would otherwise trigger (one per row
  //   change), so the user doesn't see flicker while the new active
  //   set is being computed.
  //
  //   redraw(true) — forces a FULL recalculation: column widths,
  //   virtual-DOM offsets, render-window position. Without this,
  //   when the active row count changes drastically while the user
  //   is scrolled away from the top (e.g. toggling a sidebar filter
  //   while at the bottom of the table), Tabulator keeps its
  //   rendered-row window at the OLD scroll position. The visible
  //   viewport then shows nothing but `padding-top` — the rows are
  //   rendered tens of thousands of pixels below where the user is
  //   actually looking. restoreRedraw() alone does NOT fix this; it
  //   only resumes normal redraw flow without resetting the render
  //   window.
  table.blockRedraw();
  table.setFilter((row) => passesFilters(row, {
    onReject: (clause) => { rejectedBy[clause] = (rejectedBy[clause] || 0) + 1; },
  }));
  table.restoreRedraw();
  table.redraw(true);

  const visible = table.getDataCount('active');
  const total = listings.length;
  dbg('filter', `applied filter: ${visible.toLocaleString()} visible / ${total.toLocaleString()} total (${(total - visible).toLocaleString()} hidden)`);

  // Only log the rejection breakdown when something was actually
  // rejected — the all-zeros object is just noise.
  const anyRejected = Object.values(rejectedBy).some((n) => n > 0);
  if (anyRejected) {
    const nonZero = Object.fromEntries(Object.entries(rejectedBy).filter(([, n]) => n > 0));
    dbg('filter', 'rejection breakdown (first failing clause per row):', nonZero);
  }

refreshFacetCounts();   // keep sidebar region/subcat counts in lockstep with the grid
  updateStatsBar();

  // v1.6.13: post-filter virtual-DOM render-state diagnostic.
  // Captures the exact numbers needed to spot a scroll-desync
  // regression (rows rendered far below the visible viewport) the
  // moment it happens. The check at the bottom emits a loud warning
  // if the desync condition is detected — historically this has been
  // hard to diagnose because the table just looks "blank" with no
  // obvious console error.
  logGridRenderState('post-filter');

  dbgGroupEnd('filter');
}

