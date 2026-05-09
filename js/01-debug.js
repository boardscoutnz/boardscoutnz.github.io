'use strict';

// ==========================================================================
// 01-debug.js — Debug logging (DEBUG flag, dbg helpers, BSNZ_DEBUG runtime toggles, window.BSNZ stub)
// ==========================================================================

// ============================================================================
// 1. Debug logging
//
// Strategy: every public-ish path through the app emits a tagged
// console line, so when something misbehaves you can copy the entire
// console transcript and reconstruct exactly what happened in what
// order. Lines are tagged with:
//   • a timestamp in seconds since page load (so timing/race issues
//     are visible at a glance), and
//   • a category tag (init / data / bgg / match / filter / sort / ui /
//     tabulator / export) so noisy categories can be muted independently.
//
// Toggling:
//   • Compile-time default — flip the `DEBUG` constant below to
//     `false` to ship a quiet build.
//   • Runtime — in the browser console:
//         BSNZ_DEBUG = false                       // mute everything
//         BSNZ_DEBUG_CATEGORIES.match = false      // mute one category
//         BSNZ.muteCategory('match')               // same, friendlier
//     The runtime flags shadow the compile-time defaults — see the
//     isDebugEnabled() / isCatEnabled() helpers below.
//
// State inspection:
//   The module also exposes `window.BSNZ` with helper getters so you
//   can pluck the live module state out of the console at any moment.
//   Run `BSNZ.help()` in the console for the full reference, or
//   `BSNZ.getState()` for a one-shot snapshot of everything.
// ============================================================================

const DEBUG = true;

const DEBUG_CATEGORIES = {
  init:      true,  // app bootstrap, version, DOMContentLoaded
  data:      true,  // listings.json fetch + ingest
  bgg:       true,  // BGG cache fetch + index build
  match:     true,  // BGG title-matching (aggregate stats only by default)
  filter:    true,  // applyFilters / sidebar filter changes
  sort:      true,  // header clicks, sort state changes, badge paints
  ui:        true,  // misc UI events (modal, grid hint, reset, toast)
  tabulator: true,  // Tabulator lifecycle (tableBuilt, dataSorted, ...)
  export:    true,  // CSV export
};

// ---- helpers -----------------------------------------------------------

function isDebugEnabled() {
  if (typeof window !== 'undefined' && typeof window.BSNZ_DEBUG === 'boolean') {
    return window.BSNZ_DEBUG;
  }
  return DEBUG;
}

function isCatEnabled(category) {
  if (typeof window !== 'undefined' && window.BSNZ_DEBUG_CATEGORIES &&
      typeof window.BSNZ_DEBUG_CATEGORIES[category] === 'boolean') {
    return window.BSNZ_DEBUG_CATEGORIES[category];
  }
  return DEBUG_CATEGORIES[category] !== false;
}

function nowTag() {
  // performance.now() is monotonic and millisecond-precise; convert to
  // seconds since navigationStart for human-readable timing.
  return `+${(performance.now() / 1000).toFixed(3)}s`;
}

function dbg(category, ...args) {
  if (!isDebugEnabled() || !isCatEnabled(category)) return;
  console.log(
    `%c[bsnz ${nowTag()}]%c[${category}]`,
    'color:#888',
    'color:#0a7;font-weight:bold',
    ...args
  );
}

function dbgWarn(category, ...args) {
  if (!isDebugEnabled() || !isCatEnabled(category)) return;
  console.warn(
    `%c[bsnz ${nowTag()}]%c[${category}]`,
    'color:#888',
    'color:#c80;font-weight:bold',
    ...args
  );
}

function dbgError(category, ...args) {
  // Errors are always emitted regardless of category mute, so a real
  // failure can't be hidden by an over-eager "shut up everything"
  // setting. The master DEBUG switch still suppresses them, though.
  if (!isDebugEnabled()) return;
  console.error(
    `%c[bsnz ${nowTag()}]%c[${category}]`,
    'color:#888',
    'color:#c33;font-weight:bold',
    ...args
  );
}

function dbgGroup(category, label) {
  if (!isDebugEnabled() || !isCatEnabled(category)) return;
  console.group(`[bsnz ${nowTag()}][${category}] ${label}`);
}

function dbgGroupEnd(category) {
  // category is optional — only included so callers can pair their
  // groupEnd with the same category they opened with for readability.
  if (!isDebugEnabled()) return;
  if (category && !isCatEnabled(category)) return;
  console.groupEnd();
}

function dbgTime(label) {
  if (!isDebugEnabled()) return;
  console.time(`[bsnz] ${label}`);
}

function dbgTimeEnd(label) {
  if (!isDebugEnabled()) return;
  try { console.timeEnd(`[bsnz] ${label}`); } catch (e) { /* timer may not exist */ }
}

// ---- Window helpers ----------------------------------------------------
// Stuff dropped on `window` for use from the dev console. The runtime
// toggle flags are created BEFORE any other module code runs (which is
// why this block lives up here, not at the bottom of the file).

if (typeof window !== 'undefined') {
  if (typeof window.BSNZ_DEBUG !== 'boolean') {
    window.BSNZ_DEBUG = DEBUG;
  }
  if (!window.BSNZ_DEBUG_CATEGORIES) {
    window.BSNZ_DEBUG_CATEGORIES = { ...DEBUG_CATEGORIES };
  }
  // The state-inspection object itself is filled in further down once
  // the module-scope variables it wraps are initialised — see the
  // "wire window.BSNZ" block right after the module-state declarations.
  window.BSNZ = window.BSNZ || {};
}

dbg('init', `Board Scout NZ — debug build, DEBUG=${DEBUG}, categories:`, { ...DEBUG_CATEGORIES });

