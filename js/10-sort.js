'use strict';

// ==========================================================================
// 10-sort.js — Custom multi-column sort handler (capture-phase header click intercept, mySorters source-of-truth)
// ==========================================================================

// ============================================================================
// 10. Custom multi-column sort handler
//
// Tabulator's built-in shift-click multi-sort behaviour puts the most
// recently clicked column at the FRONT of the priority list (i.e. the
// newest click wins). The user wanted the opposite: the column they
// first click should remain priority 1, and each subsequent shift-click
// should append the new column at the END as a lower-priority
// tiebreaker. This is closer to how spreadsheet apps work.
//
// We implement it by intercepting clicks on column headers in the
// capture phase, BEFORE Tabulator's own click handler runs. We compute
// the new sort order ourselves, store it in `mySorters` (the source of
// truth), then drive Tabulator with `setSort(...)`. We also drive sort-
// priority badges from `mySorters` rather than from Tabulator's
// `getSorters()`, which avoids the timing issues the previous version
// hit when Tabulator re-rendered its own header.
// ============================================================================

function setupCustomSortHandler() {
  const tableEl = document.getElementById('grid');
  if (!tableEl) {
    dbgWarn('sort', 'setupCustomSortHandler: #grid not found — handler NOT installed');
    return;
  }

  // Capture-phase listener: this runs before Tabulator's own click
  // handler. If the click is on a sortable header, we stop propagation
  // and handle the sort entirely ourselves.
  tableEl.addEventListener('click', (e) => {
    // Skip clicks on the column resize handle — those are not sort
    // clicks and Tabulator must be allowed to handle them.
    if (e.target.closest('.tabulator-col-resize-handle')) {
      dbg('sort', 'capture-phase click is on resize handle — letting Tabulator handle it');
      return;
    }

    const headerCol = e.target.closest('.tabulator-col.tabulator-sortable');
    if (!headerCol) return;
    // Only intercept clicks INSIDE this column's content area (not on
    // some adjacent element that happens to bubble through here).
    if (!tableEl.contains(headerCol)) return;

    const field = headerCol.getAttribute('tabulator-field');
    if (!field) {
      dbgWarn('sort', 'capture-phase header click had no tabulator-field attribute', headerCol);
      return;
    }

    e.stopImmediatePropagation();
    e.preventDefault();
    handleHeaderSortClick(field, e.shiftKey);
  }, true); // <-- capture phase

  dbg('sort', 'capture-phase header-click handler installed');
}

function handleHeaderSortClick(field, shiftHeld) {
  dbgGroup('sort', `header click — field=${field}, shift=${shiftHeld}`);
  dbg('sort', 'mySorters BEFORE:', mySorters.slice());

  const idx = mySorters.findIndex((s) => s.column === field);

  if (!shiftHeld) {
    // Plain click. If the clicked column is already the *only* sort,
    // toggle its direction. Otherwise replace the entire sort with a
    // single ascending sort on this column.
    if (mySorters.length === 1 && idx === 0) {
      const oldDir = mySorters[0].dir;
      mySorters[0] = { column: field, dir: oldDir === 'asc' ? 'desc' : 'asc' };
      dbg('sort', `plain click on only-active column → toggled ${oldDir} → ${mySorters[0].dir}`);
    } else {
      mySorters = [{ column: field, dir: 'asc' }];
      dbg('sort', 'plain click → replaced sort with single ascending');
    }
  } else {
    // Shift-click. New columns append at the END of the priority list
    // (lower priority than what's already there). Existing columns
    // toggle direction in place — this preserves their priority slot.
    if (idx >= 0) {
      const oldDir = mySorters[idx].dir;
      mySorters[idx] = { column: field, dir: oldDir === 'asc' ? 'desc' : 'asc' };
      dbg('sort', `shift-click on existing sort col (idx ${idx}) → toggled ${oldDir} → ${mySorters[idx].dir}`);
    } else {
      mySorters.push({ column: field, dir: 'asc' });
      dbg('sort', `shift-click on new col → appended at priority ${mySorters.length}`);
    }
  }

  dbg('sort', 'mySorters AFTER:', mySorters.slice());

  // Drive Tabulator from our state, then refresh the priority badges.
  // Deep-copy each sorter — Tabulator mutates `sorter.column` from the
  // string field name into a ColumnComponent reference in place. A
  // shallow .slice() shares the inner objects, so that mutation leaks
  // back into mySorters; afterwards mySorters[i].column is no longer
  // the string 'title' and findIndex/selectors break. v1.6.4.
  if (table) {
    table.setSort(mySorters.map((s) => ({ column: s.column, dir: s.dir })));
    dbg('sort', 'pushed mySorters into table.setSort() (deep-copied)');
  } else {
    dbgWarn('sort', 'no table — cannot push sort state to Tabulator');
  }

  applySortBadges();
  dbgGroupEnd('sort');
}

