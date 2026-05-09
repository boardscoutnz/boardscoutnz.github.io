'use strict';

// ==========================================================================
// 11-sort-badges.js — paintSortBadges() and the MutationObserver that reapplies badges after Tabulator header redraws
// ==========================================================================

// ============================================================================
// 11. Sort priority badges
//
// Goal: when the user is sorting by 2+ columns at once, paint a small
// numbered pill into each sorted column's header — `1` for the primary
// sort, `2` for the tiebreaker, and so on. A single-column sort shows
// no badge (the arrow alone is enough; the "1" would be noise).
//
// Source of truth is `mySorters` (set by setupCustomSortHandler). We do
// NOT read from Tabulator's `getSorters()` — that worked unreliably
// when Tabulator re-rendered its own header DOM mid-sort.
//
// Belt-and-braces: a MutationObserver scoped to #grid re-applies the
// badges if Tabulator wipes them during a header re-render.
// ============================================================================

let sortBadgeObserver = null;
let sortBadgeApplyScheduled = false;

function applySortBadges() {
  const tableEl = document.getElementById('grid');
  if (!tableEl) {
    dbgWarn('sort', 'applySortBadges: #grid not found');
    return;
  }

  // 1. Wipe existing badges so we can never end up with stale or
  //    duplicate pills.
  const existing = tableEl.querySelectorAll('.sort-priority');
  if (existing.length) {
    dbg('sort', `applySortBadges: wiping ${existing.length} existing badge(s)`);
    existing.forEach((n) => n.remove());
  }

  // 2. Single-column or no sort? Show nothing.
  if (mySorters.length < MIN_SORTERS_FOR_BADGES) {
    dbg('sort', `applySortBadges: ${mySorters.length} sorter(s) — under threshold of ${MIN_SORTERS_FOR_BADGES}, no badges painted`);
    return;
  }

  // 3. Add fresh badges in priority order from mySorters.
  let painted = 0;
  let missing = 0;
  mySorters.forEach((s, idx) => {
    if (!s.column) return;
    const safeField = (window.CSS && window.CSS.escape)
      ? window.CSS.escape(s.column)
      : s.column;
    const headerEl = tableEl.querySelector(
      `.tabulator-col[tabulator-field="${safeField}"]`
    );
    if (!headerEl) {
      missing++;
      return;
    }

    // Prepend the badge as the FIRST child of .tabulator-col-title.
    // Why prepend and not append:
    //   • The title gets `overflow:hidden; text-overflow:ellipsis` from
    //     Tabulator. Truncation happens on the RIGHT edge — that's
    //     where the ellipsis appears and where any overflowing content
    //     gets clipped. The LEFT edge is always visible.
    //   • A v1.6.5-style append placed the badge to the right of the
    //     text, which on narrow columns (Price=90, Listing Type=110)
    //     pushed it into the clipped region, so it never rendered.
    //   • Prepending puts the badge at the visible left edge. The title
    //     text shifts right and truncates more aggressively if needed
    //     — but the user just clicked the column, so they already know
    //     what it is, and the headerTooltip option (set in the
    //     Tabulator constructor, v1.6.7) restores the full title on
    //     hover for anyone who wants it.
    // Why not the title-holder approach v1.6.6 tried:
    //   • .tabulator-col-title-holder is laid out by Tabulator with the
    //     title as flex:1 and the sort-arrow positioned relative to
    //     those two children specifically. Inserting a third child
    //     between them broke Tabulator's layout assumptions and the
    //     sort-arrow detached from the title row. Keeping the badge
    //     INSIDE the title leaves the holder's structure untouched.
    // v1.6.7.
    const titleEl = headerEl.querySelector('.tabulator-col-title');

    const priority = idx + 1;
    const badge = document.createElement('span');
    badge.className = 'sort-priority';
    badge.textContent = String(priority);
    badge.title = `Sort priority ${priority} — ${s.dir === 'desc' ? 'descending' : 'ascending'}`;

    if (titleEl) {
      // Standard path: prepend so the badge sits at the visible left
      // edge of the title cell.
      titleEl.insertBefore(badge, titleEl.firstChild);
    } else {
      // Last-resort fallback for unusual header structures.
      const fallback = headerEl.querySelector('.tabulator-col-content') || headerEl;
      fallback.appendChild(badge);
    }
    painted++;
  });
  dbg('sort', `applySortBadges: painted ${painted} badge(s)${missing ? `, ${missing} header(s) not found in DOM` : ''}`);
}

function setupSortBadgeObserver() {
  if (sortBadgeObserver) {
    dbg('sort', 'setupSortBadgeObserver: observer already running, skipping');
    return;
  }
  const tableEl = document.getElementById('grid');
  if (!tableEl) {
    dbgWarn('sort', 'setupSortBadgeObserver: #grid not found');
    return;
  }

  // v1.6.15: scope the observer to the HEADER only. Sort-priority
  // badges only ever live inside .tabulator-header — applySortBadges
  // never touches the body. Watching the whole #grid subtree (which
  // is what we used to do) meant every virtual-DOM row mutation
  // during wheel-scrolling fired the observer callback, each call
  // forcing a synchronous querySelectorAll across the entire grid.
  // That interleaved with Tabulator's render cycle and produced
  // "scroll up 2 rows, snap back 1" stutter on wheel input.
  // Watching just the header eliminates ~99% of callback invocations
  // and the stutter goes away. The header still gets all the events
  // we actually care about (sort-arrow re-paints, column show/hide,
  // header re-renders) because those are header-DOM mutations.
  const headerEl = tableEl.querySelector('.tabulator-header');
  if (!headerEl) {
    dbgWarn('sort', 'setupSortBadgeObserver: .tabulator-header not found inside #grid — observer NOT installed (badges may not auto-recover from drift)');
    return;
  }

  sortBadgeObserver = new MutationObserver(() => {
    // Already a re-apply queued? Bail; it'll handle this mutation too.
    if (sortBadgeApplyScheduled) return;

    const expected = mySorters.length >= MIN_SORTERS_FOR_BADGES ? mySorters.length : 0;
    // Scope the count query to the header too — same reason as the
    // observe() target. No body cell ever has a .sort-priority class.
    const actual = headerEl.querySelectorAll('.sort-priority').length;
    if (actual === expected) return; // already in sync

    dbg('sort', `MutationObserver: badge count drift (expected ${expected}, found ${actual}) — scheduling re-apply`);
    sortBadgeApplyScheduled = true;
    requestAnimationFrame(() => {
      sortBadgeApplyScheduled = false;
      applySortBadges();
    });
  });
  sortBadgeObserver.observe(headerEl, { childList: true, subtree: true });
  dbg('sort', 'sort-badge MutationObserver attached to .tabulator-header (scoped — body mutations during scroll are now ignored)');
}

