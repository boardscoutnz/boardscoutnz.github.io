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
// matching `})();` closer lives at the bottom of 06-orchestrator.js (added in
// Step 7 of the pipeline plan). Do not add a closing `})();` to any earlier
// file — it would cut the closure short and hide later-file declarations.
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
