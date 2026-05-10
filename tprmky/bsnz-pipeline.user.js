// Built from tprmky/bsnz-pipeline-src/ by tprmky/build.sh — DO NOT EDIT directly.
// ==UserScript==
// @name         BSNZ Pipeline
// @namespace    https://github.com/boardscoutnz
// @version      0.1.0
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
  const VERSION = '0.1.0';
  const SCHEMA_VERSION = '1.0.0';

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
      tm_category_url:   GM_getValue('tm_category_url',
                            'https://www.trademe.co.nz/a/marketplace/toys-models/board-games'),
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
  function onRunClick() {
    // Step 3 placeholder. Steps 4-7 wire up the real pipeline phases.
    log('info', 'Run requested — pipeline not implemented yet');
  }
  function onCancelClick() {
    if (BSNZ.abortController) {
      try { BSNZ.abortController.abort(); } catch (_) {}
      log('warn', 'Cancel requested.');
    }
    setRunning(false);
    setPhase('Idle');
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

    // TM category URL
    const tmLabel = el('div', { fontWeight: '600' }, { text: 'TM category URL' });
    const tmInput = el('input', {
      width: '100%', padding: '6px', boxSizing: 'border-box',
      border: '1px solid #aaa', borderRadius: '4px'
    }, { type: 'text', value: cfg.tm_category_url, on: { change: () => {
      saveConfigKey('tm_category_url', tmInput.value.trim());
    }}});

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
      tmLabel, tmInput,
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
// 99-footer.js — closes the IIFE opened in 00-config.js.
// This file MUST sort last in tprmky/bsnz-pipeline-src/.
})();
