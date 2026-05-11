// tprmky/bsnz-pipeline-src/01-ui.js
// Floating control panel + settings dialog. Runs inside the shared IIFE
// opened in 00-config.js — references VERSION, BSNZ, log, saveConfigKey,
// clearAllConfig, REPO_OWNER/NAME, GITHUB_API, and DATA_PUBLIC_URL from
// closure scope. Inline styles only — no <style> tag, to avoid clashing
// with TM's own CSS.

  // DOM cap for the panel log. Mirrors LOG_CAP in 00-config.js (which caps
  // the in-memory BSNZ.log array). Declared locally so this file remains
  // standalone-readable; if you bump LOG_CAP, bump this too.
  const PANEL_LOG_CAP = 500;

  // Trade Me embeds search results / ads in iframes; the panel must only
  // appear in the top frame. Bail early before any DOM work.
  if (window.top !== window.self) return;

  // --- DOM helpers ----------------------------------------------------------
  function el(tag, styles, props) {
    const node = document.createElement(tag);
    if (styles) Object.assign(node.style, styles);
    if (props) for (const k in props) {
      if (k === 'text') node.textContent = props.text;
      else if (k === 'html') node.innerHTML = props.html;
      else if (k === 'on')   for (const ev in props.on) node.addEventListener(ev, props.on[ev]);
      else node[k] = props[k];
    }
    return node;
  }

  // Module-level refs populated by initPanel(). Kept as a single object so
  // later phases (Steps 4-7) can call e.g. `bsnzUi.setPhase('Scraping TM')`
  // without each module having to re-find DOM nodes.
  const bsnzUi = {
    panel: null, body: null, statusEl: null, progressEl: null,
    statsEl: null, logEl: null, runBtn: null, cancelBtn: null,
    fabEl: null, minimised: false
  };

  // --- Panel construction ---------------------------------------------------
  function buildPanel() {
    const panel = el('div', {
      position: 'fixed', top: '20px', right: '20px', zIndex: '99999',
      width: '450px', maxHeight: '80vh', overflow: 'hidden',
      background: '#ffffff', color: '#1a1a1a',
      border: '1px solid #444', borderRadius: '6px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: '13px', display: 'flex', flexDirection: 'column'
    }, { id: 'bsnz-panel' });

    // Header bar
    const header = el('div', {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 10px', background: '#222', color: '#fff',
      cursor: 'default', userSelect: 'none', flex: '0 0 auto'
    });
    const title = el('span', { flex: '1', fontWeight: '600' },
      { text: `BSNZ Pipeline v${VERSION}` });
    const historyBtn = el('button', {
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', fontSize: '15px', padding: '2px 6px'
    }, { text: '🕓️', title: 'Run history', on: { click: runHistoryRenderModal } });
    const cogBtn = el('button', {
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', fontSize: '15px', padding: '2px 6px'
    }, { text: '⚙️', title: 'Settings', on: { click: openSettings } });
    const minBtn = el('button', {
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', fontSize: '15px', padding: '2px 6px'
    }, { text: '–', title: 'Minimise', on: { click: minimisePanel } });
    header.append(title, historyBtn, cogBtn, minBtn);

    // Body container — everything below the header is hidden when minimised.
    const body = el('div', {
      padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px',
      overflowY: 'auto', flex: '1 1 auto'
    });

    // Status row
    const statusRow = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });
    statusRow.append(
      el('span', { fontWeight: '600' }, { text: 'Status:' }),
      (bsnzUi.statusEl = el('span', { color: '#555' }, { text: 'Idle' }))
    );

    // Progress bar
    const progressWrap = el('div', {
      width: '100%', height: '8px', background: '#eee',
      borderRadius: '4px', overflow: 'hidden'
    });
    bsnzUi.progressEl = el('div', {
      width: '0%', height: '100%', background: '#3b7ddd',
      transition: 'width 0.2s ease'
    });
    progressWrap.append(bsnzUi.progressEl);

    // Stats grid
    bsnzUi.statsEl = el('div', {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0px 10px',
      fontSize: '12px', color: '#333'
    });
    renderStats();

    // Full run log. Capped in memory at LOG_CAP entries (see 00-config.js);
    // the box scrolls and auto-pins to the bottom unless the user has scrolled
    // up to inspect older entries.
    const logHeader = el('div', { fontWeight: '600', fontSize: '12px' },
      { text: 'Log:' });
    bsnzUi.logEl = el('div', {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '11px', background: '#f7f7f7',
      border: '1px solid #ddd', borderRadius: '4px',
      padding: '6px', maxHeight: '30vh', overflowY: 'auto',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    });

    // Button row
    const btnRow = el('div', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    bsnzUi.runBtn = el('button', {
      flex: '1 1 auto', padding: '6px 10px',
      background: '#3b7ddd', color: '#fff', border: 'none',
      borderRadius: '4px', cursor: 'pointer', fontWeight: '600'
    }, { text: 'Run pipeline', on: { click: onRunClick } });
    bsnzUi.cancelBtn = el('button', {
      flex: '0 0 auto', padding: '6px 10px',
      background: '#c0392b', color: '#fff', border: 'none',
      borderRadius: '4px', cursor: 'pointer', display: 'none'
    }, { text: 'Cancel', on: { click: onCancelClick } });
    const openDataBtn = el('button', {
      flex: '0 0 auto', padding: '6px 10px',
      background: '#fff', color: '#333', border: '1px solid #aaa',
      borderRadius: '4px', cursor: 'pointer'
    }, {
      text: 'Open data/bsnz.json',
      on: { click: () => window.open(DATA_PUBLIC_URL, '_blank', 'noopener') }
    });
    btnRow.append(bsnzUi.runBtn, bsnzUi.cancelBtn, openDataBtn);

    // Categories panel sits between the stats grid and the log header so
    // the user can see at a glance which subcats this run will walk and
    // which have already completed (struck-through in red). Built once;
    // populated via window.bsnzRenderCategories() (see 01d-categories.js).
    bsnzUi.categoriesEl = buildCategoriesPanel();

    body.append(statusRow, progressWrap, bsnzUi.statsEl,
                bsnzUi.categoriesEl, logHeader, bsnzUi.logEl, btnRow);
    panel.append(header, body);

    bsnzUi.panel = panel;
    bsnzUi.body  = body;
    if (typeof window.bsnzRenderCategories === 'function') {
      window.bsnzRenderCategories();
    }
    refreshRunBtnEnabled();
    return panel;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatStartedAt(d) {
    if (!d) return '—';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function formatElapsed() {
    if (!BSNZ.run_started_at) return '—';
    const end = BSNZ.run_completed_at || new Date();
    const totalSec = Math.max(0, Math.floor((end - BSNZ.run_started_at) / 1000));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${mm}:${pad2(ss)}`;
  }
  function renderStats() {
    const s = BSNZ.stats;
    const rows = [
      ['TM scraped',     s.tm_scraped],
      ['BGG searched',   s.bgg_searched],
      ['BGG fetched',    s.bgg_fetched],
      ['Fuzzy matched',  s.fuzzy_matched],
      ['Committed',      s.github_committed ? 'yes' : 'no'],
      ['Started at',     formatStartedAt(BSNZ.run_started_at)],
      ['Elapsed',        formatElapsed()]
    ];
    bsnzUi.statsEl.replaceChildren();
    bsnzUi._elapsedValueEl = null;
    for (const [k, v] of rows) {
      const valueEl = el('span',
        { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
        { text: String(v) });
      if (k === 'Elapsed') bsnzUi._elapsedValueEl = valueEl;
      bsnzUi.statsEl.append(
        el('span', { color: '#666' }, { text: k }),
        valueEl
      );
    }
  }
  function updateElapsedDisplay() {
    if (bsnzUi._elapsedValueEl) {
      bsnzUi._elapsedValueEl.textContent = formatElapsed();
    }
  }

  // Panel minimised state: when minimised, the panel is hidden entirely (via
  // the `bsnz-panel-minimized` class) and the FAB is the visible affordance.
  // Not persisted — every page load starts minimised (see initPanel).
  function minimisePanel() {
    bsnzUi.minimised = true;
    if (bsnzUi.panel) bsnzUi.panel.classList.add('bsnz-panel-minimized');
    if (bsnzUi.fabEl) bsnzUi.fabEl.style.display = 'flex';
  }
  function restorePanel() {
    bsnzUi.minimised = false;
    if (bsnzUi.panel) bsnzUi.panel.classList.remove('bsnz-panel-minimized');
    if (bsnzUi.fabEl) bsnzUi.fabEl.style.display = 'none';
  }

  // FAB CSS — sizes/position/z-index copied from tm-bgbf's #fab so the two
  // buttons sit on the same baseline. The BSNZ FAB sits to the LEFT of
  // tm-bgbf's (right offset = 16 + 52 + 12 = 80px). Distinct teal accent
  // (#0d9488) keeps it visually separate from tm-bgbf's red. The pulse
  // animation activates while a pipeline run is in progress.
  let _fabStyleInjected = false;
  function ensureFabStyle() {
    if (_fabStyleInjected) return;
    const s = document.createElement('style');
    s.textContent =
      '#bsnz-fab { position: fixed; right: 80px; bottom: 16px;' +
      ' width: 52px; height: 52px; border-radius: 26px;' +
      ' background: #0d9488; color: #fff; border: 2px solid #fff;' +
      ' cursor: pointer; font-size: 22px;' +
      ' box-shadow: 0 2px 12px rgba(0,0,0,.4);' +
      ' z-index: 2147483647; padding: 0;' +
      ' display: flex; align-items: center; justify-content: center;' +
      ' transition: background 0.15s ease, transform 0.15s ease,' +
      ' box-shadow 0.15s ease; }' +
      '#bsnz-fab:hover { background: #0f766e; transform: scale(1.05);' +
      ' box-shadow: 0 4px 18px rgba(0,0,0,.5); }' +
      '#bsnz-fab.bsnz-fab-running {' +
      ' animation: bsnz-fab-pulse 1.4s ease-in-out infinite; }' +
      '@keyframes bsnz-fab-pulse {' +
      ' 0%,100% { box-shadow: 0 2px 12px rgba(0,0,0,.4),' +
      ' 0 0 0 0 rgba(13,148,136,.55); }' +
      ' 50% { box-shadow: 0 2px 12px rgba(0,0,0,.4),' +
      ' 0 0 0 10px rgba(13,148,136,0); } }' +
      '.bsnz-panel-minimized { display: none !important; }';
    document.head.appendChild(s);
    _fabStyleInjected = true;
  }

  function buildFab() {
    ensureFabStyle();
    const fab = el('button', null, {
      id: 'bsnz-fab',
      title: 'BSNZ Pipeline',
      text: '🧭',
      on: { click: restorePanel }
    });
    return fab;
  }

  function setFabRunning(active) {
    if (!bsnzUi.fabEl) return;
    bsnzUi.fabEl.classList.toggle('bsnz-fab-running', !!active);
  }

  function refreshRunBtnEnabled() {
    const hasPat = !!(BSNZ.config && BSNZ.config.pat);
    bsnzUi.runBtn.disabled = !hasPat;
    bsnzUi.runBtn.style.opacity = hasPat ? '1' : '0.5';
    bsnzUi.runBtn.style.cursor  = hasPat ? 'pointer' : 'not-allowed';
    bsnzUi.runBtn.title = hasPat ? '' : 'Set a GitHub PAT in settings first';
  }

  // --- Public phase / progress / stats setters (used by Steps 4-7) --------
  function setPhase(phase)    { if (bsnzUi.statusEl) bsnzUi.statusEl.textContent = phase; }
  function setProgress(pct)   { if (bsnzUi.progressEl)
                                  bsnzUi.progressEl.style.width =
                                    Math.max(0, Math.min(100, pct)) + '%'; }
  function setRunning(active) {
    bsnzUi.cancelBtn.style.display = active ? 'inline-block' : 'none';
    bsnzUi.runBtn.disabled = active || !BSNZ.config.pat;
    bsnzUi.runBtn.style.opacity = bsnzUi.runBtn.disabled ? '0.5' : '1';
    setFabRunning(active);
  }
  // Expose for later modules.
  window.bsnzUi = Object.assign(bsnzUi, { setPhase, setProgress, setRunning, renderStats });

  // --- Run / cancel button handlers ----------------------------------------
  // Step 4 wires up the TM scrape phase. Steps 5-7 will append further
  // phase calls inside the try-block (BGG corpus, matching, commit).
  async function onRunClick() {
    // Disable Run + show Cancel immediately so a slow first fetch can't be
    // double-triggered.
    bsnzUi.runBtn.disabled = true;
    bsnzUi.runBtn.style.opacity = '0.5';
    bsnzUi.runBtn.style.cursor  = 'not-allowed';
    bsnzUi.cancelBtn.style.display = 'inline-block';
    setFabRunning(true);

    BSNZ.run_started_at   = new Date();
    BSNZ.run_completed_at = null;
    if (BSNZ._elapsedTimerId) clearInterval(BSNZ._elapsedTimerId);
    BSNZ._elapsedTimerId  = setInterval(updateElapsedDisplay, 1000);
    runHistoryStart();

    BSNZ.stats.tm_scraped = 0;
    renderStats();
    setPhase('Scraping TM');
    setProgressIndeterminate(true);

    BSNZ.abortController = new AbortController();
    let runOutcome = 'success';
    let runErrorMsg = null;
    try {
      await runScrapePhase(BSNZ.abortController.signal);
      setPhase('Refreshing BGG corpus');
      await runCorpusRefreshPhase(BSNZ.abortController.signal);
      setPhase('Matching titles');
      await runMatchPhase(BSNZ.abortController.signal);
      // Step 7 takes over from here — orchestrator handles optional
      // /thing enrichment + previous-data load + merge + commit.
      log('info', 'Scrape + corpus + match complete; later phases not yet implemented.');
      setPhase('Done');
    } catch (e) {
      log('error', 'Pipeline failed: ' + e.message);
      setPhase(e.message === 'aborted' ? 'Cancelled' : 'Error');
      const aborted = e.name === 'AbortError' || e.message === 'aborted' ||
        (BSNZ.abortController && BSNZ.abortController.signal && BSNZ.abortController.signal.aborted);
      runOutcome  = aborted ? 'cancelled' : 'error';
      runErrorMsg = aborted ? null : (e && e.message);
    } finally {
      BSNZ.run_completed_at = new Date();
      if (BSNZ._elapsedTimerId) {
        clearInterval(BSNZ._elapsedTimerId);
        BSNZ._elapsedTimerId = null;
      }
      updateElapsedDisplay();
      BSNZ.abortController = null;
      bsnzUi.cancelBtn.style.display = 'none';
      setFabRunning(false);
      setProgressIndeterminate(false);
      setProgress(0);
      refreshRunBtnEnabled();
      // Idempotent — runHistoryFinish is a no-op if already called.
      try { runHistoryFinish(runOutcome, runErrorMsg); }
      catch (e) { log('error', 'runHistoryFinish failed: ' + (e && e.message)); }
    }
  }
  function onCancelClick() {
    if (BSNZ.abortController) {
      try { BSNZ.abortController.abort(); } catch (_) {}
    }
    log('warn', 'Cancelled by user');
  }

  // --- Progress bar: per-phase update entry-point --------------------------
  // 02-tm-scraper.js (and Step 5+ phases) call window.bsnzUpdateProgress to
  // drive the bar without poking DOM directly. The 'scrape' phase has no
  // up-front total page count, so the bar runs as an indeterminate stripe
  // until a later phase swaps in a real percentage.
  window.bsnzUpdateProgress = function (phase, info) {
    if (!bsnzUi.statusEl) return;
    if (phase === 'scrape') {
      setProgressIndeterminate(true);
      const slug = (info && info.subcat) || '…';
      const n = (info && info.pageNum) || '?';
      const added = (info && info.addedCount) != null ? info.addedCount : '?';
      setPhase(`Scraping ${slug} page ${n} (+${added})`);
      renderStats();
    } else if (phase === 'match') {
      setProgressIndeterminate(false);
      const processed = (info && info.processed) || 0;
      const total     = (info && info.total) || 0;
      const exact     = (info && info.exact) || 0;
      const fuzzy     = (info && info.fuzzy) || 0;
      const unmatched = (info && info.unmatched) || 0;
      if (total > 0) setProgress((processed / total) * 100);
      setPhase(`Matching titles ${processed}/${total} (${exact} exact, ${fuzzy} fuzzy, ${unmatched} unmatched)`);
    }
  };

  // Indeterminate animation needs a CSS keyframe — inline `style` can't
  // hold @keyframes, so we inject a tiny <style> tag once on first toggle.
  let _stripeStyleInjected = false;
  function ensureStripeStyle() {
    if (_stripeStyleInjected) return;
    const s = document.createElement('style');
    s.textContent =
      '@keyframes bsnz-stripes { from { background-position: 0 0; }' +
      ' to { background-position: 24px 0; } }' +
      '.bsnz-indeterminate { width: 100% !important;' +
      ' background-image: linear-gradient(45deg,' +
      ' rgba(255,255,255,0.35) 25%, transparent 25%,' +
      ' transparent 50%, rgba(255,255,255,0.35) 50%,' +
      ' rgba(255,255,255,0.35) 75%, transparent 75%, transparent) !important;' +
      ' background-size: 24px 24px !important;' +
      ' animation: bsnz-stripes 0.8s linear infinite; }';
    document.head.appendChild(s);
    _stripeStyleInjected = true;
  }
  function setProgressIndeterminate(active) {
    if (!bsnzUi.progressEl) return;
    if (active) {
      ensureStripeStyle();
      bsnzUi.progressEl.classList.add('bsnz-indeterminate');
    } else {
      bsnzUi.progressEl.classList.remove('bsnz-indeterminate');
    }
  }

  // Segmented-control CSS for the Crawl-speed picker. Native radios are
  // visually hidden and the adjacent <label> is styled as a button; the
  // :checked + label selector cannot be expressed via inline styles, hence
  // a one-shot <style> injection on first dialog open.
  let _crawlSpeedStyleInjected = false;
  function ensureCrawlSpeedStyle() {
    if (_crawlSpeedStyleInjected) return;
    const s = document.createElement('style');
    s.textContent =
      '.bsnz-seg { display: flex; gap: 0; border: 1px solid #aaa;' +
      ' border-radius: 4px; overflow: hidden; padding: 0; margin: 0; }' +
      '.bsnz-seg input { position: absolute; opacity: 0;' +
      ' pointer-events: none; }' +
      '.bsnz-seg label { flex: 1 1 0; text-align: center;' +
      ' padding: 6px 8px; cursor: pointer; font-size: 12px;' +
      ' background: #f7f7f7; color: #333;' +
      ' border-left: 1px solid #ddd; user-select: none; }' +
      '.bsnz-seg label:first-of-type { border-left: none; }' +
      '.bsnz-seg input:checked + label {' +
      ' background: #3b7ddd; color: #fff; font-weight: 600; }' +
      '.bsnz-seg-chip { display: inline-block; padding: 1px 8px;' +
      ' margin-left: 8px; border-radius: 10px; background: #eef3fb;' +
      ' color: #1a3d7c; font-size: 11px; font-weight: 600;' +
      ' vertical-align: middle; }';
    document.head.appendChild(s);
    _crawlSpeedStyleInjected = true;
  }

  // --- Log subscription -----------------------------------------------------
  // Newest-on-top renderer. Each log() call prepends a single row; on initial
  // render after panel construction, BSNZ.log is replayed in order so newest
  // ends up at the top. Avoids the scrollHeight read that the full-rebuild
  // model performed on every entry (and the forced layout cost it implied).
  function htmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function buildLogRow(entry) {
    const colour = entry.level === 'error' ? '#c0392b'
                 : entry.level === 'warn'  ? '#b7791f'
                 : entry.level === 'debug' ? '#666'
                 : '#1a1a1a';
    const prefix = `${entry.ts.slice(11, 19)} [${entry.level}] `;
    const escapedMsg = htmlEscape(entry.msg);
    let html = htmlEscape(prefix) + escapedMsg;
    if (entry.link && entry.link.href && entry.link.text) {
      const escapedHref = htmlEscape(entry.link.href);
      const escapedText = htmlEscape(entry.link.text);
      html += ' ' + '<a href="' + escapedHref +
              '" target="_blank" rel="noreferrer">' +
              escapedText + '</a>';
    }
    return el('div', {
      color: colour, marginBottom: '2px', lineHeight: '12px'
    }, { html });
  }
  function renderLog(entry) {
    if (!bsnzUi.logEl) return;
    const elBox = bsnzUi.logEl;
    if (entry) {
      elBox.insertBefore(buildLogRow(entry), elBox.firstChild);
    } else {
      elBox.replaceChildren();
      const entries = BSNZ.log || [];
      for (const e of entries) {
        elBox.insertBefore(buildLogRow(e), elBox.firstChild);
      }
    }
    while (elBox.childNodes.length > PANEL_LOG_CAP) {
      elBox.removeChild(elBox.lastChild);
    }
  }
  window.bsnzOnLogEntry = renderLog;

  // --- Unmatched titles section --------------------------------------------
  // Rendered into the panel body at end-of-run when runMatchPhase reports
  // any unresolved listings. Each row lets the user paste a BGG ID (validated
  // against BSNZ.bgg_corpus.byId), open BGG's search for the raw title, or
  // skip (a sentinel override that suppresses this title on future runs).
  // The override store lives in 03-bgg-corpus.js (setOverride / getOverride);
  // entries persist across Tampermonkey reloads via GM_setValue.
  bsnzUi.unmatchedSection = null;
  function buildUnmatchedSection() {
    if (bsnzUi.unmatchedSection) return bsnzUi.unmatchedSection;
    const section = el('div', {
      display: 'none', marginTop: '6px',
      borderTop: '1px solid #ddd', paddingTop: '8px'
    });
    section.append(
      el('div', { fontWeight: '600', marginBottom: '4px' },
        { text: 'Unmatched titles' }),
      el('div', { fontSize: '11px', color: '#666', marginBottom: '6px' },
        { text: 'Paste a BGG ID (digits) and Save, or Skip to suppress.' })
    );
    const list = el('div', {
      maxHeight: '40vh', overflowY: 'auto',
      border: '1px solid #ddd', borderRadius: '4px', padding: '4px'
    });
    section.append(list);
    bsnzUi.unmatchedSection = section;
    bsnzUi.unmatchedListEl = list;
    if (bsnzUi.body) bsnzUi.body.append(section);
    return section;
  }

  function renderUnmatchedRow(entry) {
    const row = el('div', {
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '4px', borderBottom: '1px solid #eee', flexWrap: 'wrap'
    });
    const titleEl = el('span', {
      flex: '1 1 60%', fontSize: '12px', wordBreak: 'break-word'
    }, { text: entry.raw });
    const idInput = el('input', {
      width: '90px', padding: '2px 4px', fontSize: '12px',
      border: '1px solid #aaa', borderRadius: '3px'
    }, { type: 'text', placeholder: 'BGG ID', inputMode: 'numeric' });
    const statusEl = el('span', {
      fontSize: '11px', color: '#888', flex: '1 1 100%'
    }, { text: '' });
    const saveBtn = el('button', {
      padding: '3px 8px', fontSize: '11px',
      background: '#3b7ddd', color: '#fff',
      border: 'none', borderRadius: '3px', cursor: 'pointer'
    }, { text: 'Save', on: { click: () => {
      const raw = (idInput.value || '').trim();
      const id = parseInt(raw, 10);
      if (!Number.isFinite(id) || id <= 0) {
        statusEl.textContent = 'Enter a positive integer BGG ID.';
        statusEl.style.color = '#c0392b';
        return;
      }
      if (!BSNZ.bgg_corpus || !BSNZ.bgg_corpus.byId.has(id)) {
        statusEl.textContent = 'ID not in corpus — refresh the corpus or check the ID.';
        statusEl.style.color = '#c0392b';
        return;
      }
      setOverride(entry.norm, id);
      const game = BSNZ.bgg_corpus.byId.get(id);
      statusEl.textContent = `Saved override → ${game.primaryName} (#${id}).`;
      statusEl.style.color = '#1e8449';
      idInput.disabled = true;
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';
    } } });
    const searchUrl =
      'https://boardgamegeek.com/geeksearch.php?action=search&q=' +
      encodeURIComponent(entry.raw) + '&objecttype=thing';
    const searchLink = el('a', {
      fontSize: '11px', color: '#3b7ddd', textDecoration: 'underline'
    }, { text: 'Search BGG', href: searchUrl, target: '_blank', rel: 'noopener' });
    const skipBtn = el('button', {
      padding: '3px 8px', fontSize: '11px',
      background: '#fff', color: '#555', border: '1px solid #aaa',
      borderRadius: '3px', cursor: 'pointer'
    }, { text: 'Skip', on: { click: () => {
      setOverride(entry.norm, null);
      statusEl.textContent = 'Skipped — will be suppressed on future runs.';
      statusEl.style.color = '#7f8c8d';
      idInput.disabled = true;
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.5';
      skipBtn.disabled = true;
      skipBtn.style.opacity = '0.5';
    } } });
    row.append(titleEl, idInput, saveBtn, searchLink, skipBtn, statusEl);
    return row;
  }

  window.bsnzShowUnmatched = function (unmatched) {
    if (!unmatched || unmatched.length === 0) return;
    const section = buildUnmatchedSection();
    bsnzUi.unmatchedListEl.replaceChildren();
    for (const entry of unmatched) {
      bsnzUi.unmatchedListEl.append(renderUnmatchedRow(entry));
    }
    section.style.display = 'block';
    // Auto-restore the panel if currently minimised so the user notices.
    if (bsnzUi.minimised) restorePanel();
  };

  // --- Init -----------------------------------------------------------------
  function initPanel() {
    if (document.getElementById('bsnz-panel')) return; // idempotent
    if (!document.body) { // very early — defer
      document.addEventListener('DOMContentLoaded', initPanel, { once: true });
      return;
    }
    const panel = buildPanel();
    document.body.appendChild(panel);

    // FAB lives as a sibling of the panel. Built and attached unconditionally;
    // the panel starts minimised so the FAB is the visible affordance on every
    // page load (state intentionally not persisted across loads).
    const fab = buildFab();
    document.body.appendChild(fab);
    bsnzUi.fabEl = fab;
    minimisePanel();

    // Render any log entries that accumulated before the panel existed.
    renderLog();

    log('info', 'Panel initialised.');
  }

  // GM menu commands — give the user a way back to the panel even if it's
  // minimised or scrolled off-screen on a long TM page.
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open BSNZ panel', () => {
      if (!bsnzUi.panel) initPanel();
      if (bsnzUi.minimised) restorePanel();
      bsnzUi.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    GM_registerMenuCommand('Open BSNZ settings', () => {
      if (!bsnzUi.panel) initPanel();
      openSettings();
    });
  }

  // The @run-at directive is document-idle, so DOM is normally ready. Keep
  // the defensive readyState check in case a TM script blocks parsing.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPanel, { once: true });
  } else {
    initPanel();
  }
