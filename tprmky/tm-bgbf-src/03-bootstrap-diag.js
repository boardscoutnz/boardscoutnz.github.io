
// ============================================================================
  // 2b. BOOTSTRAP DIAGNOSTICS — log the runtime environment once at script
  //     load, so future "why didn't X happen?" investigations have the basics
  //     on hand without re-running anything.
  // ============================================================================

  dbg('init', `tm-bgbf v${VERSION} userscript file evaluated`);
  dbg('init', `Page URL: ${location.href}`);
  dbg('init', `Document readyState: ${document.readyState}`);
  dbg('init', `User agent: ${navigator.userAgent}`);
  dbg('init', 'Tampermonkey GM API availability:', {
    GM_xmlhttpRequest:      typeof GM_xmlhttpRequest      !== 'undefined',
    GM_setValue:            typeof GM_setValue            !== 'undefined',
    GM_getValue:            typeof GM_getValue            !== 'undefined',
    GM_addStyle:            typeof GM_addStyle            !== 'undefined',
    GM_registerMenuCommand: typeof GM_registerMenuCommand !== 'undefined',
    GM_openInTab:           typeof GM_openInTab           !== 'undefined',
    indexedDB:              typeof indexedDB              !== 'undefined',
  });
  dbg('init', `PURGE_TITLE_RX compiled with ${PURGE_TITLE_KEYWORDS.length} keywords`);
  dbg('init', `${CATEGORIES.length} subcategories will be crawled:`, CATEGORIES.map((c) => c.slug));
  dbg('init', `Sampler config: ${SAMPLE_SUBCATS.length} subcats × (${SAMPLE_PER_SUBCAT_BASEGAMES} base-games + ${SAMPLE_PER_SUBCAT_EXPANSIONS} expansions) = up to ${SAMPLE_SUBCATS.length * (SAMPLE_PER_SUBCAT_BASEGAMES + SAMPLE_PER_SUBCAT_EXPANSIONS)} rows`);

