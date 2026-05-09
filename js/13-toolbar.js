'use strict';

// ==========================================================================
// 13-toolbar.js — wireToolbarControls (BGG mode, export, clear-sort), updateStatsBar, CSV export of filtered view
// ==========================================================================

// ============================================================================
// 13. Toolbar / stats / export
// ============================================================================

function wireToolbarControls() {
  // Mode toggle (Board Games ↔ Expansions) — the two buttons live
  // inside #mode-toggle in the topbar. Only one is .active at a time.
  // v1.6.19: Accessories mode removed (those listings are now blacklisted
  // upstream by the userscript); replaced with Expansions, which the
  // userscript flags via isExpansion=true based on title heuristics.
  const btnModeBg  = document.getElementById('btn-mode-boardgames');
  const btnModeExp = document.getElementById('btn-mode-expansions');
  function setMode(next) {
    if (filters.viewMode === next) return;
    filters.viewMode = next;
    btnModeBg.classList.toggle('active',  next === 'board-games');
    btnModeExp.classList.toggle('active', next === 'expansions');
    btnModeBg.setAttribute('aria-selected',  next === 'board-games');
    btnModeExp.setAttribute('aria-selected', next === 'expansions');
    dbg('filter', `[event] view mode → ${next}`);
    // Region/sub-category counts in the sidebar are baked from the
    // currently-relevant half of the corpus, so re-render the dropdowns
    // when the mode flips. Existing user selections in those dropdowns
    // are intentionally cleared because the option set may differ.
    filters.regions = new Set();
    filters.subcats = new Set();
    populateFilterDropdowns();
    applyFilters();
  }
  if (btnModeBg)  btnModeBg.addEventListener('click',  () => setMode('board-games'));
  if (btnModeExp) btnModeExp.addEventListener('click', () => setMode('expansions'));

  document.getElementById('btn-clear-sort').addEventListener('click', () => {
    dbg('sort', '[event] Clear sort button clicked');
    if (!table) {
      dbgWarn('sort', 'no table — cannot clear sort');
      return;
    }
    mySorters = [];
    table.setSort([]);
    applySortBadges();   // wipe — sorters is now empty
  });

  document.getElementById('btn-export-filtered').addEventListener('click', () => {
    dbg('export', '[event] Export filtered CSV button clicked');
    exportFilteredCsv();
  });

  // ---- BGG Mode toggle -------------------------------------------
  //
  // BGG Mode controls the two BGG_BASIC_COLUMNS (bgg_rank +
  // bgg_average). The button starts in the ON state — the columns
  // are constructed with `visible: true` so they appear on first
  // paint without needing any JS to fire.
  //
  // Note: the BGG sidebar filter section (#sidebar-bgg-section) is
  // intentionally NOT toggled by this button. Those filters operate
  // on bgg_weight / bgg_min_players / bgg_playing_time — fields that
  // are still null in csv-only BGG cache builds — and will be
  // surfaced separately once the full BGG pipeline is wired up. The
  // four BGG_FULL_COLUMNS are also not affected by this toggle for
  // the same reason.

  const bggToggle = document.getElementById('btn-show-bgg');
  if (bggToggle) {
    bggToggle.addEventListener('click', () => {
      if (!table) {
        dbgWarn('ui', '[event] BGG Mode toggle clicked before table ready — ignoring');
        return;
      }
      bggMode = !bggMode;
      dbg('ui', `[event] BGG Mode toggle clicked → now ${bggMode ? 'ON' : 'OFF'}`);
      for (const f of BGG_BASIC_COLUMNS) {
        try {
          if (bggMode) table.showColumn(f);
          else         table.hideColumn(f);
          dbg('ui', `  → ${bggMode ? 'showColumn' : 'hideColumn'}("${f}") OK`);
        } catch (e) {
          dbgWarn('ui', `  → ${bggMode ? 'showColumn' : 'hideColumn'}("${f}") threw:`, e.message);
        }
      }
      // v1.6.19: showColumn/hideColumn does NOT re-run Tabulator's
      // fitColumns layout pass on its own — the previously calculated
      // widths stay frozen, leaving a blank gap on the right when BGG
      // columns are hidden. redraw(true) forces a full layout
      // recalculation so the visible columns expand to fill the
      // container according to their existing widthGrow ratios
      // (TradeMe Listing=4, Region=2, BGG Entry=2). This also pairs
      // nicely with the desync mitigations documented in §12.
      try { table.redraw(true); }
      catch (e) { dbgWarn('ui', '  → redraw(true) after BGG toggle threw:', e.message); }
      bggToggle.classList.toggle('primary', bggMode);
      bggToggle.setAttribute('aria-pressed', bggMode ? 'true' : 'false');
      bggToggle.textContent = bggMode ? 'BGG Mode: ON' : 'BGG Mode: OFF';
    });
  }
}

function updateStatsBar() {
  const bar = document.getElementById('topbar-stats');
  if (!bar) {
    dbgWarn('ui', 'updateStatsBar: #topbar-stats not found');
    return;
  }
  if (!listings.length) {
    bar.innerHTML = '<span class="badge muted">no data loaded</span>';
    dbg('ui', 'updateStatsBar: listings is empty — showing "no data loaded" placeholder');
    return;
  }
  // Only count listings in the active mode so totals/sidebar counts
  // reflect "this view's corpus", not the whole DB.
  const inMode = (l) => (filters.viewMode === 'expansions')
    ? !!l.isExpansion
    :  !l.isExpansion;
  const corpus = listings.filter(inMode);

  // v1.6.14: classifications removed. Topbar now shows a single
  // pill — "<matched> / <corpus> BGG-matched" — and only the
  // sidebar Condition counts (ct-new / ct-used / ct-unranked) are
  // updated below. The "X visible / X board games" pill was
  // dropped at the same time; the visible count is still computed
  // for the dbg() line at the bottom because it's useful for
  // debugging filter behaviour.
  let matched = 0;
  const condCounts = { new: 0, used: 0 };
  let unrankedCount = 0;
  for (const l of corpus) {
    if (l.bgg_id) matched++;
    if (l.condition === 'new') condCounts.new++;
    else if (l.condition === 'used') condCounts.used++;
    if (!l.bgg_id) unrankedCount++;
  }
  const visible = table ? table.getDataCount('active') : corpus.length;
  bar.innerHTML = `
    <span class="badge ${bgg.loaded ? '' : 'muted'}">${matched.toLocaleString()} / ${corpus.length.toLocaleString()} BGG-matched</span>
  `;

  const setCount = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = `(${n})`; };
  setCount('ct-new', condCounts.new);
  setCount('ct-used', condCounts.used);
  setCount('ct-unranked', unrankedCount);

  dbg('ui', `updateStatsBar: visible=${visible.toLocaleString()}, corpus=${corpus.length.toLocaleString()}, BGG-matched=${matched}/${corpus.length} (${corpus.length ? ((100 * matched) / corpus.length).toFixed(1) : '0.0'}%), new=${condCounts.new}, used=${condCounts.used}, unranked=${unrankedCount}`);
}

function exportFilteredCsv() {
  dbgGroup('export', 'exportFilteredCsv');
  if (!table) {
    dbgWarn('export', 'no table — bailing');
    dbgGroupEnd('export');
    return;
  }
  const rows = table.getData('active');
  dbg('export', `${rows.length.toLocaleString()} active rows fetched from grid`);
  if (!rows.length) {
    dbgWarn('export', 'no rows match the current filter — aborting export with toast');
    showToast('No rows match the current filter', 'error');
    dbgGroupEnd('export');
    return;
  }
  // v1.6.14: classification + confidence dropped (Personal/Business
  // pipeline removed); seller fields (memberId, nickname) gone too.
  const headers = [
    'listingId', 'title', 'url', 'price', 'priceLabel', 'condition',
    'region',                                          // v1.6.17: district + suburb dropped
    'isExpansion', 'isNewListing',
    'bgg_id', 'bgg_name', 'bgg_year', 'bgg_rank', 'bgg_average',
    'bgg_weight', 'bgg_min_players', 'bgg_max_players', 'bgg_playing_time',
    'bgg_match_confidence',                            // v1.6.18: endDate + closed dropped
  ];
  dbg('export', `building CSV with ${headers.length} columns`);
  const csv = [headers.join(',')];
  for (const r of rows) {
    csv.push(headers.map((h) => csvCell(r[h])).join(','));
  }
  const filename = `boardscoutnz-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
  const body = csv.join('\n');
  dbg('export', `CSV ready: filename="${filename}", ${csv.length.toLocaleString()} lines, ~${(body.length / 1024).toFixed(1)} KB`);
  downloadFile(filename, 'text/csv;charset=utf-8', body);
  showToast(`Exported ${rows.length.toLocaleString()} rows to ${filename}`, 'success');
  dbgGroupEnd('export');
}

function csvCell(v) {
  if (v == null) return '';
  let s;
  if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadFile(filename, mime, content) {
  dbg('export', `downloadFile: triggering browser download for "${filename}" (${mime}, ${content.length.toLocaleString()} bytes)`);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

