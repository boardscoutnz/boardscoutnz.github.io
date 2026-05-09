  // ============================================================================
  // 18. INITIALISATION
  // ============================================================================

  function init() {
    grp('init', `=== init() starting === v${VERSION}`);
    const initT = startTimer();
    try {
      log(`Trade Me Board Games Collector v${VERSION} loaded on`, location.href);
      dbg('init', 'building shadow-DOM control panel');
      ensureUI();
      dbg('init', 'registering Tampermonkey menu commands');
      registerMenuCommands();
      dbg('init', 'opening IndexedDB (async, non-blocking)');
      openDb()
        .then(() => dbg('db', '✅ IndexedDB opened successfully'))
        .catch((e) => { dbgErr('db', 'IndexedDB open failed:', e); err('IndexedDB open failed', e); });
      log('init complete');
      dbg('init', `=== init() finished synchronously in ${initT()} (db open continues async) ===`);
    } catch (e) {
      dbgErr('init', 'FATAL during init:', e, e && e.stack);
      console.error('[bgbf] FATAL during init:', e, e && e.stack);
    } finally {
      grpEnd();
    }
  }

  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      log('pageshow from bfcache; re-mounting UI');
      try {
        if (uiHost && !document.documentElement.contains(uiHost)) {
          uiShadow = null; uiHost = null;
        }
        ensureUI();
      } catch (e) { err('bfcache re-mount failed', e); }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  window.addEventListener('load', () => {
    try {
      if (!document.getElementById('tm-bgbf-host')) {
        log('host missing at window load; re-running ensureUI');
        uiShadow = null; uiHost = null;
        ensureUI();
      }
    } catch (e) { err('load-time UI check failed', e); }
  }, { once: true });
