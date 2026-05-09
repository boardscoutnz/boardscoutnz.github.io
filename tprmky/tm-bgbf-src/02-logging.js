  // 2. LOGGING
  //
  // Two-tier system, modelled on the bgg-ranks-exporter userscript.
  //
  //   • Bare `log/warn/err` (backwards-compat) — uncategorised, used by the
  //     existing ~80 call sites throughout the file. Keep them as-is.
  //
  //   • Categorised `dbg/dbgWarn/dbgErr/grp/grpEnd/timer` — used by anything
  //     added from v0.7.6 onwards. Every line carries a category tag so the
  //     DevTools console can be filtered to one subsystem at a time:
  //
  //         filter "[bgbf]"             → everything from this script
  //         filter "[bgbf][export]"     → only the export pipeline
  //         filter "[bgbf][fetch]"      → only network calls
  //
  //     Categories in active use:
  //       init, ui, db, fetch, extract, normalise,
  //       run, export, sample, download, menu
  //
  // Compile-time and runtime toggles:
  //
  //   • Flip DEBUG=false below to ship a quiet build.
  //   • In the DevTools console at runtime:
  //         BGBF_DEBUG = false                       // master mute
  //         BGBF_DEBUG_CATEGORIES.export = false     // mute one category
  //   The runtime flags shadow the compile-time defaults via the
  //   isDbgEnabled / isCatEnabled helpers below.
  // ============================================================================

  const DEBUG = true;

  const DEBUG_CATEGORIES = {
    init:       true,
    ui:         true,
    db:         true,
    fetch:      true,
    extract:    true,
    normalise:  true,
    run:        true,
    export:     true,
    sample:     true,
    download:   true,
    menu:       true,
  };

  // Expose runtime toggles on window so they can be flipped from the console.
  if (typeof window !== 'undefined') {
    if (typeof window.BGBF_DEBUG !== 'boolean')   window.BGBF_DEBUG = DEBUG;
    if (!window.BGBF_DEBUG_CATEGORIES)            window.BGBF_DEBUG_CATEGORIES = { ...DEBUG_CATEGORIES };
  }

  function isDbgEnabled() {
    if (typeof window !== 'undefined' && typeof window.BGBF_DEBUG === 'boolean') return window.BGBF_DEBUG;
    return DEBUG;
  }
  function isCatEnabled(cat) {
    if (typeof window !== 'undefined' && window.BGBF_DEBUG_CATEGORIES &&
        typeof window.BGBF_DEBUG_CATEGORIES[cat] === 'boolean') {
      return window.BGBF_DEBUG_CATEGORIES[cat];
    }
    return DEBUG_CATEGORIES[cat] !== false;
  }

  // Bare aliases — used by every existing log/warn/err call site in this file.
  // Keep these names stable; touching them means a global rewrite.
  const log  = (...args) => console.log(LOG_PREFIX, ...args);
  const warn = (...args) => console.warn(LOG_PREFIX, ...args);
  const err  = (...args) => console.error(LOG_PREFIX, ...args);

  // Categorised helpers — preferred for any new logging from v0.7.6 onwards.
  const _catTag = (cat) => `${LOG_PREFIX}[${cat}]`;
  function dbg(cat, ...args) {
    if (!isDbgEnabled() || !isCatEnabled(cat)) return;
    console.log(_catTag(cat), ...args);
  }
  function dbgWarn(cat, ...args) {
    if (!isDbgEnabled() || !isCatEnabled(cat)) return;
    console.warn(_catTag(cat), ...args);
  }
  function dbgErr(cat, ...args) {
    // Errors are always emitted regardless of category mute, so a real
    // failure can't be hidden by an over-eager "shut up" setting. The
    // master DEBUG switch still suppresses them, though.
    if (!isDbgEnabled()) return;
    console.error(_catTag(cat), ...args);
  }
  function grp(cat, label) {
    if (!isDbgEnabled() || !isCatEnabled(cat)) return;
    console.group(`${_catTag(cat)} ${label}`);
  }
  function grpEnd() {
    if (!isDbgEnabled()) return;
    console.groupEnd();
  }
  function startTimer() {
    const t0 = performance.now();
    return () => `${(performance.now() - t0).toFixed(0)}ms`;
  }
