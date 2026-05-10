// ==UserScript==
// @name         BSNZ Pipeline
// @namespace    https://github.com/boardscoutnz
// @version      0.3.8
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
// @connect      s3.amazonaws.com
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @require      https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.basic.min.js
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
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
  const VERSION = '0.3.8';
  const SCHEMA_VERSION = '1.1.0';

  // --- Repository / endpoint constants --------------------------------------
  const REPO_OWNER = 'boardscoutnz';
  const REPO_NAME  = 'boardscoutnz.github.io';
  const DATA_PATH  = 'data/bsnz.json';
  const BRANCH     = 'main';
  const BGG_API_BASE       = 'https://boardgamegeek.com/xmlapi2';
  const BGG_RANKS_PAGE_URL = 'https://boardgamegeek.com/data_dumps/bg_ranks';
  const GITHUB_API         = 'https://api.github.com';

  // Public URL for the committed data file (used by the "Open data/bsnz.json"
  // button in 01-ui.js). Branch-aware so a dev fork pointing at a non-main
  // branch still resolves correctly.
  const DATA_PUBLIC_URL =
    `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${DATA_PATH}`;

  // --- Pacing / retry knobs -------------------------------------------------
  const TM_REQUEST_DELAY_MS      = 1500;   // between TM page loads
  const BGG_API_REQUEST_DELAY_MS = 2000;   // 0.5 req/sec, polite to BGG
  const BGG_BATCH_SIZE       = 20;     // IDs per /thing call
  const BGG_RETRY_BASE_MS    = 3000;   // for HTTP 202 (BGG queues responses)
  const BGG_MAX_RETRIES      = 5;
  const FUZZY_MATCH_THRESHOLD = 0.4;   // Fuse.js score; lower = stricter
  const TM_MAX_PAGES_PER_SUBCAT = 100;  // hard cap; defence against runaway pagination if TM serves content past the actual end. Real subcats are well under 30 pages.
  const TM_MAX_RETRIES_PER_PAGE = 3;  // retries per TM page on transient errors (429/502/503/504); after exhaustion, skip the page with a warning rather than abort the run.

  // Crawl-speed presets. Terminology + multiplier values mirror tm-bgbf's
  // CRAWL_SPEED_PRESETS (tprmky/tm-bgbf-src/01-constants.js — delayMultiplier
  // field). Internally the picked value is stored as `pacing_multiplier` and
  // multiplied into TM_REQUEST_DELAY_MS / BGG_API_REQUEST_DELAY_MS by the TM
  // and BGG fetchers; the segmented control in the settings dialog is purely
  // a UI rename of the existing pacing knob.
  const CRAWL_SPEED_PRESETS = {
    fastest:  1.0,
    balanced: 1.75,
    safest:   3.5
  };
  const CRAWL_SPEED_DEFAULT = 'balanced';

  // Map a stored numeric pacing_multiplier back to the closest preset label.
  // Round to the nearest preset value rather than requiring exact match, so
  // legacy stored values (e.g. 2.0 from the old slider) still resolve cleanly.
  function crawlSpeedLabelForMultiplier(m) {
    const entries = Object.entries(CRAWL_SPEED_PRESETS);
    let best = entries[0];
    let bestDist = Infinity;
    for (const [label, val] of entries) {
      const d = Math.abs(val - m);
      if (d < bestDist) { bestDist = d; best = [label, val]; }
    }
    return best[0];
  }

  // --- Trade Me category coverage ------------------------------------------
  // Hardcoded list of TM subcategory paths the scraper walks per run. Ported
  // verbatim from the legacy tprmky/tm-bgbf-src/01-constants.js CATEGORIES
  // array — keep in sync. Note: card-games and games-puzzles-other sit at the
  // games-puzzles-tricks parent level, NOT under board-games. Each listing
  // emitted by 02-tm-scraper.js is tagged with the slug of the first subcat
  // it was found in (dedupe is first-subcat-wins across the 8 paths).
  const TM_ORIGIN = 'https://www.trademe.co.nz';
  // Stripped from the front of subcat URLs when rendered in the log link text,
  // so the visible label is the leaf path rather than the full origin tree.
  const TM_DISPLAY_PREFIX_STRIP = 'https://www.trademe.co.nz/a/marketplace/toys-models';
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
      pat:                          GM_getValue('gh_pat',                          ''),
      pat_set_at:                   GM_getValue('gh_pat_set_at',                   null),
      auto_commit:                  GM_getValue('auto_commit',                     false),
      pacing_multiplier:            GM_getValue('pacing_multiplier',               1.0),
      // BGG corpus refresh knobs (Step 5). TTL is in days; the force flag is a
      // one-shot — runCorpusRefreshPhase resets it to false after a forced run.
      bgg_corpus_cache_ttl_days:    GM_getValue('bgg_corpus_cache_ttl_days',       7),
      bgg_corpus_force_refresh:     GM_getValue('bgg_corpus_force_refresh',        false),
      bgg_corpus_max_rank:          GM_getValue('bgg_corpus_max_rank',             5000),
      // Optional /thing enrichment (Step 7 wires the call site). When false,
      // 04-bgg-api.js's bggFetchThings is dormant.
      enable_bgg_api_enrichment:    GM_getValue('enable_bgg_api_enrichment',       false)
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
  // we just append to BSNZ.log and the UI will render when it initialises.
  //
  // opts.consoleMsg: alternative message for the browser console only. The
  // panel-rendered text always uses msg; consoleMsg lets a caller keep verbose
  // detail in DevTools while showing a streamlined line in the panel.
  // opts.link: optional structured { text, href } rendered as an <a> after
  // msg in the panel. Structured (not markdown) so the renderer can HTML-escape
  // both fields and prevent XSS from arbitrary message content.
  const LOG_CAP = 500;
  function log(level, msg, opts) {
    const entry = {
      ts:    new Date().toISOString(),
      level,
      msg:   String(msg),
      link:  (opts && opts.link) || null
    };
    BSNZ.log.push(entry);
    while (BSNZ.log.length > LOG_CAP) BSNZ.log.shift();
    const consoleFn = level === 'error' ? 'error'
                    : level === 'warn'  ? 'warn'
                    : 'log';
    const consoleText = (opts && opts.consoleMsg) || msg;
    console[consoleFn](`[bsnz:${level}]`, consoleText);
    if (typeof window.bsnzOnLogEntry === 'function') {
      try { window.bsnzOnLogEntry(entry); } catch (_) { /* ignore UI errors */ }
    }
  }

  // Prime BSNZ.config so 01-ui.js and later modules see real values from the
  // first read, not the empty-object placeholder.
  BSNZ.config = loadConfig();
  log('info', `BSNZ Pipeline v${VERSION} loaded; schema v${SCHEMA_VERSION}.`);
