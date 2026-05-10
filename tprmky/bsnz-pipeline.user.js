// Built from tprmky/bsnz-pipeline-src/ by tprmky/build.sh — DO NOT EDIT directly.
// ==UserScript==
// @name         BSNZ Pipeline
// @namespace    https://github.com/boardscoutnz
// @version      0.2.2
// @description  Scrape Trade Me board games, enrich with BGG, commit to GitHub.
// @author       Gavin McGruddy
// @match        https://www.trademe.co.nz/*
// @match        https://trademe.co.nz/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      boardgamegeek.com
// @connect      api.github.com
// @require      https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.basic.min.js
// @run-at       document-idle
// ==/UserScript==

// The pipeline runs inside one shared IIFE so every concatenated module sees
// the same closure scope (no imports/exports). The opener lives here; the
// matching `})();` closer lives in 99-footer.js (which sorts last in the
// build glob). Do not add a closing `})();` to any earlier file — it would
// cut the closure short and hide later-file declarations.
(function () {
  'use strict';

  // --- Versioning -----------------------------------------------------------
  // VERSION must match the `// @version` directive above. SCHEMA_VERSION must
  // match `data/bsnz.json` `schema_version`. Bump both together when the
  // listing-record shape changes incompatibly.
  const VERSION = '0.2.2';
  const SCHEMA_VERSION = '1.1.0';

  // --- Repository / endpoint constants --------------------------------------
  const REPO_OWNER = 'boardscoutnz';
  const REPO_NAME  = 'boardscoutnz.github.io';
  const DATA_PATH  = 'data/bsnz.json';
  const BRANCH     = 'main';
  const BGG_BASE   = 'https://boardgamegeek.com/xmlapi2';
  const GITHUB_API = 'https://api.github.com';

  // Public URL for the committed data file (used by the "Open data/bsnz.json"
  // button in 01-ui.js). Branch-aware so a dev fork pointing at a non-main
  // branch still resolves correctly.
  const DATA_PUBLIC_URL =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${DATA_PATH}`;

  // --- Pacing / retry knobs -------------------------------------------------
  const TM_REQUEST_DELAY_MS  = 1500;   // between TM page loads
  const BGG_REQUEST_DELAY_MS = 2000;   // 0.5 req/sec, polite to BGG
  const BGG_BATCH_SIZE       = 20;     // IDs per /thing call
  const BGG_RETRY_BASE_MS    = 3000;   // for HTTP 202 (BGG queues responses)
  const BGG_MAX_RETRIES      = 5;
  const FUZZY_MATCH_THRESHOLD = 0.4;   // Fuse.js score; lower = stricter
  const TM_MAX_PAGES_PER_SUBCAT = 100;  // hard cap; defence against runaway pagination if TM serves content past the actual end. Real subcats are well under 30 pages.

  // --- Trade Me category coverage ------------------------------------------
  // Hardcoded list of TM subcategory paths the scraper walks per run. Ported
  // verbatim from the legacy tprmky/tm-bgbf-src/01-constants.js CATEGORIES
  // array — keep in sync. Note: card-games and games-puzzles-other sit at the
  // games-puzzles-tricks parent level, NOT under board-games. Each listing
  // emitted by 02-tm-scraper.js is tagged with the slug of the first subcat
  // it was found in (dedupe is first-subcat-wins across the 8 paths).
  const TM_ORIGIN = 'https://www.trademe.co.nz';
  const TM_SUBCATS = [
    { slug: 'card-games',          name: 'Card games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/card-games' },
    { slug: 'childrens-games',     name: "Children's games",
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/childrens-games' },
    { slug: 'dice-games',          name: 'Dice games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/dice-games' },
    { slug: 'party-games',         name: 'Party games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/party-games' },
    { slug: 'strategy-war-games',  name: 'Strategy & war games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/strategy-war-games' },
    { slug: 'word-games',          name: 'Word games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/word-games' },
    { slug: 'other',               name: 'Board games — Other',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/other' },
    { slug: 'games-puzzles-other', name: 'Games & Puzzles — Other',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/other' }
  ];

  // --- Global state holder --------------------------------------------------
  // One mutable object that every later module reads and writes. Kept as a
  // single named root so the console-poke surface is `BSNZ.…`.
  const BSNZ = {
    config: {},
    cache:  {},
    log:    [],
    stats:  {
      tm_scraped:       0,
      bgg_searched:     0,
      bgg_fetched:      0,
      fuzzy_matched:    0,
      github_committed: false
    },
    abortController: null
  };

  // --- Config helpers -------------------------------------------------------
  // GM_setValue / GM_getValue persist across runs and survive script updates.
  // `pat_set_at` is a separate key so the UI can show "(set, last updated …)"
  // without leaking the PAT itself.
  function loadConfig() {
    return {
      pat:               GM_getValue('gh_pat',               ''),
      pat_set_at:        GM_getValue('gh_pat_set_at',        null),
      auto_commit:       GM_getValue('auto_commit',          false),
      pacing_multiplier: GM_getValue('pacing_multiplier',    1.0)
    };
  }

  function saveConfigKey(key, value) {
    GM_setValue(key, value);
    BSNZ.config = loadConfig();
  }

  function clearAllConfig() {
    GM_listValues().forEach(GM_deleteValue);
    BSNZ.config = loadConfig();
  }

  // --- Logger ---------------------------------------------------------------
  // Levels: 'info' | 'warn' | 'error' | 'debug'. The UI module sets
  // `window.bsnzOnLogEntry` to subscribe; if it's not set yet (early boot)
  // we just append to BSNZ.log and the UI will render the tail when it
  // initialises.
  function log(level, ...parts) {
    const entry = {
      ts:    new Date().toISOString(),
      level,
      msg:   parts.map(String).join(' ')
    };
    BSNZ.log.push(entry);
    const consoleFn = level === 'error' ? 'error'
                    : level === 'warn'  ? 'warn'
                    : 'log';
    console[consoleFn](`[bsnz:${level}]`, ...parts);
    if (typeof window.bsnzOnLogEntry === 'function') {
      try { window.bsnzOnLogEntry(entry); } catch (_) { /* ignore UI errors */ }
    }
  }

  // Prime BSNZ.config so 01-ui.js and later modules see real values from the
  // first read, not the empty-object placeholder.
  BSNZ.config = loadConfig();
  log('info', `BSNZ Pipeline v${VERSION} loaded; schema v${SCHEMA_VERSION}.`);
// tprmky/bsnz-pipeline-src/01-ui.js
// Floating control panel + settings dialog. Runs inside the shared IIFE
// opened in 00-config.js — references VERSION, BSNZ, log, saveConfigKey,
// clearAllConfig, REPO_OWNER/NAME, GITHUB_API, and DATA_PUBLIC_URL from
// closure scope. Inline styles only — no <style> tag, to avoid clashing
// with TM's own CSS.

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
    minimised: false
  };

  // --- Panel construction ---------------------------------------------------
  function buildPanel() {
    const panel = el('div', {
      position: 'fixed', top: '20px', right: '20px', zIndex: '99999',
      width: '400px', maxHeight: '80vh', overflow: 'hidden',
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
    const cogBtn = el('button', {
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', fontSize: '15px', padding: '2px 6px'
    }, { text: '⚙', title: 'Settings', on: { click: openSettings } });
    const minBtn = el('button', {
      background: 'transparent', border: 'none', color: '#fff',
      cursor: 'pointer', fontSize: '15px', padding: '2px 6px'
    }, { text: '–', title: 'Minimise', on: { click: toggleMinimise } });
    header.append(title, cogBtn, minBtn);

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
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px',
      fontSize: '12px', color: '#333'
    });
    renderStats();

    // Log tail
    const logHeader = el('div', { fontWeight: '600', fontSize: '12px' },
      { text: 'Log (last 10):' });
    bsnzUi.logEl = el('div', {
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '11px', background: '#f7f7f7',
      border: '1px solid #ddd', borderRadius: '4px',
      padding: '6px', maxHeight: '160px', overflowY: 'auto',
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

    body.append(statusRow, progressWrap, bsnzUi.statsEl, logHeader, bsnzUi.logEl, btnRow);
    panel.append(header, body);

    bsnzUi.panel = panel;
    bsnzUi.body  = body;
    refreshRunBtnEnabled();
    return panel;
  }

  function renderStats() {
    const s = BSNZ.stats;
    const rows = [
      ['TM scraped',     s.tm_scraped],
      ['BGG searched',   s.bgg_searched],
      ['BGG fetched',    s.bgg_fetched],
      ['Fuzzy matched',  s.fuzzy_matched],
      ['Committed',      s.github_committed ? 'yes' : 'no']
    ];
    bsnzUi.statsEl.replaceChildren();
    for (const [k, v] of rows) {
      bsnzUi.statsEl.append(
        el('span', { color: '#666' }, { text: k }),
        el('span', { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
           { text: String(v) })
      );
    }
  }

  function toggleMinimise() {
    bsnzUi.minimised = !bsnzUi.minimised;
    bsnzUi.body.style.display = bsnzUi.minimised ? 'none' : 'flex';
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

    BSNZ.stats.tm_scraped = 0;
    renderStats();
    setPhase('Scraping TM');
    setProgressIndeterminate(true);

    BSNZ.abortController = new AbortController();
    try {
      await runScrapePhase(BSNZ.abortController.signal);
      log('info', 'Scrape complete; later phases not yet implemented.');
      setPhase('Done');
    } catch (e) {
      log('error', 'Pipeline failed: ' + e.message);
      setPhase(e.message === 'aborted' ? 'Cancelled' : 'Error');
    } finally {
      BSNZ.abortController = null;
      bsnzUi.cancelBtn.style.display = 'none';
      setProgressIndeterminate(false);
      setProgress(0);
      refreshRunBtnEnabled();
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

  // --- Log subscription -----------------------------------------------------
  function appendLogEntry(entry) {
    if (!bsnzUi.logEl) return;
    const colour = entry.level === 'error' ? '#c0392b'
                 : entry.level === 'warn'  ? '#b7791f'
                 : entry.level === 'debug' ? '#666'
                 : '#1a1a1a';
    const line = el('div', { color: colour, marginBottom: '2px' }, {
      text: `${entry.ts.slice(11, 19)} [${entry.level}] ${entry.msg}`
    });
    bsnzUi.logEl.prepend(line);
    while (bsnzUi.logEl.childElementCount > 10) {
      bsnzUi.logEl.removeChild(bsnzUi.logEl.lastChild);
    }
  }
  window.bsnzOnLogEntry = appendLogEntry;

  // --- Settings dialog ------------------------------------------------------
  let settingsOverlay = null;
  function openSettings() {
    if (settingsOverlay) return; // already open
    BSNZ.config = (typeof loadConfig === 'function') ? loadConfig() : BSNZ.config;
    const cfg = BSNZ.config;

    const overlay = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.45)', zIndex: '100000',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const dialog = el('div', {
      width: '480px', maxHeight: '85vh', overflowY: 'auto',
      background: '#fff', color: '#1a1a1a', borderRadius: '6px',
      padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      display: 'flex', flexDirection: 'column', gap: '12px'
    });

    const titleRow = el('div', { display: 'flex', alignItems: 'center' });
    titleRow.append(
      el('span', { flex: '1', fontWeight: '700', fontSize: '15px' },
        { text: 'BSNZ Pipeline settings' }),
      el('button', {
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: '18px', padding: '0 4px'
      }, { text: '×', title: 'Close', on: { click: closeSettings } })
    );

    // PAT row
    const patLabel = el('div', { fontWeight: '600' }, { text: 'GitHub Personal Access Token' });
    const patStatus = el('div', { fontSize: '11px', color: '#666' }, {
      text: cfg.pat_set_at
        ? `(set, last updated ${cfg.pat_set_at.slice(0, 10)})`
        : '(not set)'
    });
    const patInput = el('input', {
      width: '100%', padding: '6px', boxSizing: 'border-box',
      border: '1px solid #aaa', borderRadius: '4px'
    }, { type: 'password', placeholder: 'ghp_…', value: cfg.pat || '' });
    const patBtnRow = el('div', { display: 'flex', gap: '6px' });
    const savePatBtn = el('button', {
      padding: '4px 10px', background: '#3b7ddd', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Save PAT', on: { click: () => {
      const v = patInput.value.trim();
      if (!v) { log('warn', 'PAT empty — not saved.'); return; }
      saveConfigKey('gh_pat', v);
      saveConfigKey('gh_pat_set_at', new Date().toISOString());
      patStatus.textContent = `(set, last updated ${BSNZ.config.pat_set_at.slice(0, 10)})`;
      log('info', 'PAT saved.');
      refreshRunBtnEnabled();
    }}});
    const testPatBtn = el('button', {
      padding: '4px 10px', background: '#fff', color: '#333',
      border: '1px solid #aaa', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Test PAT', on: { click: () => testPat(patInput.value.trim() || cfg.pat) } });
    patBtnRow.append(savePatBtn, testPatBtn);

    // TM categories — hardcoded list, no longer user-configurable. The 8
    // subcat paths live in TM_SUBCATS in 00-config.js; the scraper walks them
    // in order with first-subcat-wins dedupe.
    const tmInfo = el('div', { fontSize: '12px', color: '#333', lineHeight: '1.4' }, {
      text: 'TM categories (hardcoded): 8 subcats — card-games, childrens-games, dice-games, party-games, strategy-war-games, word-games, board-games/other, games-puzzles/other'
    });
    const tmInfoHint = el('div', { fontSize: '11px', color: '#666' }, {
      text: '(see docs/13-pipeline-pre-merged-data.md)'
    });

    // Auto-commit
    const autoRow = el('label', {
      display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
    });
    const autoCb = el('input', {}, {
      type: 'checkbox', checked: !!cfg.auto_commit,
      on: { change: () => saveConfigKey('auto_commit', autoCb.checked) }
    });
    autoRow.append(autoCb,
      el('span', null, { text: 'Auto-commit (skip final confirmation prompt)' }));

    // Pacing slider
    const paceLabel = el('div', { fontWeight: '600' }, { text: 'Pacing multiplier' });
    const paceVal = el('span', { fontVariantNumeric: 'tabular-nums', marginLeft: '8px' },
      { text: `${cfg.pacing_multiplier}x` });
    const paceSlider = el('input', { width: '100%' }, {
      type: 'range', min: '0.5', max: '3', step: '0.1',
      value: String(cfg.pacing_multiplier),
      on: { input: () => paceVal.textContent = `${paceSlider.value}x`,
            change: () => saveConfigKey('pacing_multiplier', parseFloat(paceSlider.value)) }
    });
    const paceRow = el('div', { display: 'flex', alignItems: 'center' });
    paceRow.append(paceSlider, paceVal);

    // Clear-all (two-step)
    const clearWrap = el('div', { borderTop: '1px solid #eee', paddingTop: '10px' });
    let clearArmed = false;
    const clearBtn = el('button', {
      padding: '6px 10px', background: '#c0392b', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Clear all data (cache, PAT, settings)', on: { click: () => {
      if (!clearArmed) {
        clearArmed = true;
        clearBtn.textContent = 'Click again to confirm — this is irreversible';
        clearBtn.style.background = '#7d2018';
        setTimeout(() => {
          clearArmed = false;
          clearBtn.textContent = 'Clear all data (cache, PAT, settings)';
          clearBtn.style.background = '#c0392b';
        }, 5000);
        return;
      }
      clearAllConfig();
      log('warn', 'All BSNZ pipeline data cleared.');
      closeSettings();
      refreshRunBtnEnabled();
    }}});
    clearWrap.append(clearBtn);

    dialog.append(
      titleRow,
      patLabel, patStatus, patInput, patBtnRow,
      tmInfo, tmInfoHint,
      autoRow,
      paceLabel, paceRow,
      clearWrap
    );
    overlay.append(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });
    document.body.appendChild(overlay);
    settingsOverlay = overlay;
  }
  function closeSettings() {
    if (!settingsOverlay) return;
    settingsOverlay.remove();
    settingsOverlay = null;
  }

  function testPat(pat) {
    if (!pat) { log('error', 'PAT empty — cannot test.'); return; }
    log('info', 'Testing PAT against GitHub…');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}`,
      headers: {
        'Authorization': `token ${pat}`,
        'Accept':        'application/vnd.github+json'
      },
      onload: (r) => {
        if (r.status === 200) {
          log('info', 'PAT OK — repo accessible.');
          if (typeof GM_notification === 'function') {
            try { GM_notification({ text: 'PAT OK', title: 'BSNZ', timeout: 3000 }); } catch (_) {}
          }
        } else {
          log('error', `PAT test failed: HTTP ${r.status} ${r.statusText || ''}`.trim());
        }
      },
      onerror: (e) => log('error', 'PAT test network error:', e && e.error || 'unknown')
    });
  }

  // --- Init -----------------------------------------------------------------
  function initPanel() {
    if (document.getElementById('bsnz-panel')) return; // idempotent
    if (!document.body) { // very early — defer
      document.addEventListener('DOMContentLoaded', initPanel, { once: true });
      return;
    }
    const panel = buildPanel();
    document.body.appendChild(panel);

    // Replay any log entries that accumulated before the panel existed.
    const tail = BSNZ.log.slice(-10);
    for (const entry of tail) appendLogEntry(entry);

    log('info', 'Panel initialised.');
  }

  // GM menu commands — give the user a way back to the panel even if it's
  // minimised or scrolled off-screen on a long TM page.
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Open BSNZ panel', () => {
      if (!bsnzUi.panel) initPanel();
      if (bsnzUi.minimised) toggleMinimise();
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
// tprmky/bsnz-pipeline-src/02-tm-scraper.js
// ===== TM scraper module =====
// Inputs:  TM_SUBCATS (from 00-config.js) — 8 hardcoded subcategory paths.
// Outputs: BSNZ.tm_listings = [ {tm_id, tm_url, tm_title, ..., tm_subcat}, ... ]
// Side effects: updates BSNZ.stats.tm_scraped, calls log() and updateProgress().
//
// Runs inside the shared IIFE opened in 00-config.js — so TM_REQUEST_DELAY_MS,
// TM_ORIGIN, TM_SUBCATS, BSNZ, log, etc. resolve from closure scope.
//
// Extraction strategy. The legacy TM scraper (tprmky/tm-bgbf-src/) showed
// that TM's search-result pages are Next.js-rendered: the listing array is
// embedded as JSON inside <script id="__NEXT_DATA__">, with a DOM card
// fallback when that script is absent. We re-use that two-tier approach
// here, but emit the bsnz.json record shape (tm_id / tm_url / tm_title /
// tm_price_nzd / tm_buy_now_nzd / tm_condition / tm_location / tm_subcat) —
// see docs/13-pipeline-pre-merged-data.md.

  async function runScrapePhase(signal) {
    log('info', 'TM scrape phase starting');
    BSNZ.tm_listings = [];
    BSNZ.stats.tm_scraped = 0;
    // Dedupe lives outside the subcat loop: first-subcat-wins, so a listing
    // that appears in both card-games and games-puzzles-other (TM lets sellers
    // cross-list) is tagged with the slug it was first seen in.
    const seen = new Set();

    for (let i = 0; i < TM_SUBCATS.length; i++) {
      const subcat = TM_SUBCATS[i];
      let pageUrl = TM_ORIGIN + subcat.path;
      let pageNum = 1;
      while (pageUrl) {
        if (signal.aborted) throw new Error('aborted');
        log('info', `Fetching ${subcat.slug} page ${pageNum}: ${pageUrl}`);
        const html = await fetchTMPageHtml(pageUrl, signal);
        const { listings, nextUrl } = parseTMListingsPage(html, pageUrl);
        let added = 0;
        for (const listing of listings) {
          if (seen.has(listing.tm_id)) continue;
          seen.add(listing.tm_id);
          listing.tm_subcat = subcat.slug;
          BSNZ.tm_listings.push(listing);
          added++;
        }
        BSNZ.stats.tm_scraped = BSNZ.tm_listings.length;
        tmUpdateProgress('scrape', { subcat: subcat.slug, pageNum, addedCount: added });
        if (added === 0) {
          log('info', `${subcat.slug}: no new listings on page ${pageNum} (TM page-end overshoot) — moving to next subcat after ${pageNum} page(s).`);
          break;
        }
        if (pageNum >= TM_MAX_PAGES_PER_SUBCAT) {
          log('warn', `${subcat.slug}: hit hard cap of ${TM_MAX_PAGES_PER_SUBCAT} pages — stopping. Investigate whether this subcat genuinely has more listings.`);
          break;
        }
        pageUrl = nextUrl;
        pageNum++;
        if (pageUrl) {
          await tmSleep(BSNZ.config.pacing_multiplier * TM_REQUEST_DELAY_MS, signal);
        }
      }
      // Pace between subcats too — back-to-back hits on the same TM origin
      // would defeat the polite-rate guard. Skip the trailing sleep after the
      // last subcat so the phase ends promptly.
      if (i < TM_SUBCATS.length - 1) {
        await tmSleep(BSNZ.config.pacing_multiplier * TM_REQUEST_DELAY_MS, signal);
      }
    }
    log('info', `TM scrape complete: ${BSNZ.tm_listings.length} listings across ${TM_SUBCATS.length} subcats`);
  }

  // GM_xmlhttpRequest doesn't accept an AbortSignal natively; it returns a
  // handle with .abort(). Bridge the signal manually so cancel propagates.
  function fetchTMPageHtml(url, signal) {
    return new Promise((resolve, reject) => {
      let aborted = false;
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Accept': 'text/html' },
        timeout: 30000,
        onload: (r) => {
          if (aborted) return;
          if (r.status === 200) resolve(r.responseText);
          else reject(new Error('TM HTTP ' + r.status));
        },
        onerror: (e) => {
          if (aborted) return;
          reject(new Error('TM network error: ' + ((e && e.error) || 'unknown')));
        },
        ontimeout: () => {
          if (aborted) return;
          reject(new Error('TM request timeout'));
        }
      });
      if (signal) {
        const onAbort = () => {
          aborted = true;
          try { if (handle && typeof handle.abort === 'function') handle.abort(); } catch (_) {}
          reject(new Error('aborted'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function parseTMListingsPage(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let rawListings = [];
    let totalCount = null;
    const nd = extractNextData(doc);
    if (nd) {
      const arr = findListingArrayInJson(nd);
      if (arr && arr.length) {
        rawListings = arr;
        totalCount = pickFirstPath(nd, [
          'props.pageProps.totalCount',
          'props.pageProps.searchResults.totalCount',
          'props.pageProps.results.totalCount',
          'props.pageProps.listings.totalCount',
          'props.pageProps.searchResults.foundItems'
        ]);
      }
    }

    let listings;
    if (rawListings.length) {
      listings = rawListings.map(normaliseTmListing).filter(Boolean);
    } else {
      listings = scrapeTmDomCards(doc);
    }

    const nextUrl = computeNextUrl(sourceUrl, listings.length, totalCount);
    return { listings, nextUrl };
  }

  function extractNextData(doc) {
    const el = doc.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent); } catch (_) { return null; }
  }

  // BFS for the longest array of objects whose elements look like listings
  // (have a listingId / ListingId field). Mirrors the legacy
  // findListingArraysInJson() heuristic but returns the single best array.
  function findListingArrayInJson(root) {
    const found = [];
    const stack = [root];
    const visited = new WeakSet();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);
      if (Array.isArray(node)) {
        if (node.length && typeof node[0] === 'object' && node[0] &&
            (node[0].listingId != null || node[0].ListingId != null)) {
          found.push(node);
        }
        for (const v of node) if (v && typeof v === 'object') stack.push(v);
      } else {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }
    found.sort((a, b) => b.length - a.length);
    return found[0] || null;
  }

  function getPath(obj, path) {
    if (obj == null) return undefined;
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function pickFirst(obj, keys) {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  function pickFirstPath(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (v != null && v !== '') return v;
    }
    return null;
  }

  function toNum(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parsePriceText(text) {
    if (!text) return null;
    const m = String(text).match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function cleanLocation(s) {
    if (s == null) return null;
    let cleaned = String(s)
      .split(/\s*(?:Closes|Closing|Listed|Ends|Started|Closed)\b/i)[0]
      .split(/[—–]/)[0]
      .replace(/^[\s·•,|]+|[\s·•,|]+$/g, '')
      .trim();
    return cleaned || null;
  }

  // Map TM's raw __NEXT_DATA__ listing object to the bsnz.json TM-sourced
  // field shape. Field-name candidates mirror tm-bgbf-src/09-normaliser.js.
  function normaliseTmListing(raw) {
    if (!raw) return null;
    const idRaw = pickFirst(raw, ['listingId', 'ListingId', 'id']);
    const idNum = toNum(idRaw);
    if (!idNum) return null;
    const tm_id = String(idNum);

    const tm_title = String(pickFirst(raw, ['title', 'Title', 'name']) || '').trim();
    if (!tm_title) return null;

    const startPrice = toNum(pickFirst(raw, [
      'startPrice', 'StartPrice', 'currentBid', 'CurrentBid',
      'currentPrice', 'CurrentPrice', 'minimumNextBid', 'MinimumNextBid'
    ]));
    const buyNow = toNum(pickFirst(raw, ['buyNowPrice', 'BuyNowPrice', 'buyNow', 'BuyNow']));
    const priceDisplay = pickFirst(raw, ['priceDisplay', 'PriceDisplay', 'displayPrice', 'DisplayPrice']);
    const tm_price_nzd = startPrice ?? buyNow ?? parsePriceText(priceDisplay);
    const tm_buy_now_nzd = buyNow;

    const conditionRaw = String(pickFirst(raw, ['condition', 'Condition']) || '').toLowerCase();
    const tm_condition = conditionRaw === 'new' ? 'New'
                       : conditionRaw === 'used' ? 'Used'
                       : '';

    const tm_location = cleanLocation(pickFirst(raw, [
      'region', 'Region', 'regionName', 'RegionName', 'location', 'Location'
    ])) || '';

    const tm_url = `${TM_ORIGIN}/a/marketplace/listing/${tm_id}`;

    return { tm_id, tm_url, tm_title, tm_price_nzd, tm_buy_now_nzd, tm_condition, tm_location };
  }

  // DOM-cards fallback (used when __NEXT_DATA__ is missing or empty).
  // Selectors ported from tm-bgbf-src/08-extraction.js scrapeDomCards().
  function scrapeTmDomCards(doc) {
    const out = [];
    const cards = doc.querySelectorAll(
      'a[href*="/listing/"], [data-testid*="search-card"], [class*="search-card"]'
    );
    const seen = new Set();
    cards.forEach((node) => {
      const a = node.tagName === 'A' ? node : node.querySelector('a[href*="/listing/"]');
      const dataId = node.getAttribute && node.getAttribute('data-listing-id');
      let id = dataId;
      if (!id && a) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/listing\/(\d+)/);
        if (m) id = m[1];
      }
      if (!id || seen.has(id)) return;
      seen.add(id);

      const tm_title = (node.querySelector('h3, [class*="title"]')?.textContent ||
                        a?.getAttribute('title') || '').trim();
      if (!tm_title) return;
      const priceText = (node.querySelector('[class*="price"]')?.textContent || '').trim();
      const tm_price_nzd = parsePriceText(priceText);
      const locRaw = (node.querySelector('[class*="location"], [class*="region"]')?.textContent || '').trim();
      const tm_location = cleanLocation(locRaw) || '';
      const tm_url = `${TM_ORIGIN}/a/marketplace/listing/${id}`;

      out.push({
        tm_id: String(id),
        tm_url,
        tm_title,
        tm_price_nzd,
        tm_buy_now_nzd: null,
        tm_condition: '',
        tm_location
      });
    });
    return out;
  }

  // TM paginates via ?page=N. Increment until a page returns zero listings,
  // or until cumulative count reaches totalCount, whichever comes first.
  function computeNextUrl(currentUrl, listingsThisPage, totalCount) {
    if (!listingsThisPage) return null;
    let u;
    try { u = new URL(currentUrl); } catch (_) { return null; }
    const curPage = parseInt(u.searchParams.get('page') || '1', 10) || 1;
    if (totalCount && BSNZ.stats.tm_scraped >= totalCount) return null;
    u.searchParams.set('page', String(curPage + 1));
    return u.toString();
  }

  function tmSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        }, { once: true });
      }
    });
  }

  function tmUpdateProgress(phase, info) {
    if (typeof window.bsnzUpdateProgress === 'function') {
      window.bsnzUpdateProgress(phase, {
        ...info,
        total: BSNZ.stats.tm_scraped
      });
    }
  }

// 99-footer.js — closes the IIFE opened in 00-config.js.
// This file MUST sort last in tprmky/bsnz-pipeline-src/.
})();
