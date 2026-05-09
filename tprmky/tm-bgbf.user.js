// ==UserScript==
// @name         Trade Me Board Games Bulk Fetcher (Collector)
// @namespace    https://github.com/yourname/tm-bgbf
// @version      0.7.14
// @description  Collect-only edition. Bulk-fetch live Card-game and selected Board-game listings from Trade Me, purge listings whose title matches the blacklist (accessory keywords now folded into the blacklist), tag expansions vs base games, flag freshly-seen listings, and AUTO-EXPORT a JSON file at the end of every run for the standalone web dashboard to consume.
// @author       you
// @match        https://www.trademe.co.nz/*
// @match        https://trademe.co.nz/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      trademe.co.nz
// @connect      www.trademe.co.nz
// @connect      api.trademe.co.nz
// @connect      self
// @noframes
// ==/UserScript==

/* eslint-disable no-console */


(function () {
  'use strict';

  console.log('[bgbf] script file evaluated at', new Date().toISOString(), location.href);

  // ============================================================================
  // 1. CONSTANTS
  // ============================================================================

  const VERSION = '0.7.14';
  const LOG_PREFIX = '[bgbf]';

  // ─────────────────────────────────────────────────────────────────────────
  // Anti-detection humanization (v0.7.14)
  // ─────────────────────────────────────────────────────────────────────────
  // Pools rotated per-request by 07-network.js fetchHtml() to avoid emitting
  // an identical request fingerprint on every fetch. Mean delay across a run
  // is preserved by 04-utilities.js politeSleep() — these pools only affect
  // header shape, not timing. NZ-plausible Accept-Language values; trivially
  // varied Accept values. Keep both pools small — wider pools would be more
  // human but also more obviously enumerated.
  const ACCEPT_LANGUAGE_POOL = [
    'en-NZ,en;q=0.9',
    'en-NZ,en-AU;q=0.9,en;q=0.8',
    'en-AU,en-NZ;q=0.9,en;q=0.8',
    'en-NZ,en-GB;q=0.9,en;q=0.8',
    'en-NZ,en-US;q=0.8,en;q=0.7',
  ];
  const ACCEPT_HEADER_POOL = [
    'text/html,application/xhtml+xml',
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  ];
  // Long "human pause" frequency (1 in N requests). The pause is 3×–6× the
  // normal mean, immediately offset by shortening the next 2–3 polite sleeps
  // so the overall budget is unchanged. See politeSleep() in 04-utilities.js.
  const HUMAN_PAUSE_FREQUENCY = 32;     // 1-in-32 (within the requested 25–40 band)
  const HUMAN_PAUSE_MULT_MIN  = 3;
  const HUMAN_PAUSE_MULT_MAX  = 6;
  const HUMAN_PAUSE_COMPENSATION_REQUESTS = 3;  // spread the offset across the next N polite sleeps

  // Categories crawled by the bulk fetcher.
  //
  // The first six entries plus `other` are the original deliberately-chosen
  // sub-categories under games-puzzles-tricks/board-games (with card-games as
  // a separate sibling under games-puzzles-tricks).
  //
  // v0.7.0 adds `games-puzzles-other`: the parent-category "Other" bucket,
  // which is a sibling of card-games and board-games at the games-puzzles-
  // tricks level — NOT nested under board-games. Two different "other"
  // buckets need two different slugs, hence the longer name.
  const CATEGORIES = [
    { slug: 'card-games',         name: 'Card games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/card-games' },
    { slug: 'childrens-games',    name: "Children's games",
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/childrens-games' },
    { slug: 'dice-games',         name: 'Dice games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/dice-games' },
    { slug: 'party-games',        name: 'Party games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/party-games' },
    { slug: 'strategy-war-games', name: 'Strategy & war games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/strategy-war-games' },
    { slug: 'word-games',         name: 'Word games',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/word-games' },
    { slug: 'other',              name: 'Board games — Other',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/board-games/other' },
    { slug: 'games-puzzles-other', name: 'Games & Puzzles — Other',
      path: '/a/marketplace/toys-models/games-puzzles-tricks/other' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Title blacklist
  // ─────────────────────────────────────────────────────────────────────────
  // Keywords/phrases below within a listing title will cause it to be excluded
  // AND on every post-process pass:

  const PURGE_TITLE_KEYWORDS = [
    'Briarpatch', 'beer pong', 'rubik', 'rubiks', 'Any', 'buy now per game', 'Casino', 'punch', 'punching', 'Poker', 'Craps', 'Chair', 'noughts and crosses', 'Doll house', 'dollhouse', 'Deck Case', 'Billiards', 'jenga', 'Snooker', 'Subbuteo', 'Air Hockey', 'chess', 'jigsaw', 'mahjong', 'outdoor', 'vintage', 'backgammon', 'scrabble', 'cornhole', 'warhammer', 'wargaming', 'd&d', 'dnd', 'dungeons and dragons', 'dungeons & dragons', 'heroquest', 'pathfinder', 'cthulhu', 'q workshop', 'mtg', 'magic the gathering', 'yu-gi-oh', 'yugioh', 'keyforge', 'battletech', 'heroscape', 'unlock!', 'exit the game', 'escape room', 'exploding kittens', 'top trumps', 'tarot deck', 'tarot', 'polyhedral', 'dice set', 'dice set dice games', 'card binder', 'card shuffler', 'trading card', 'monopoly', 'cribbage', 'yahtzee', 'rummy', 'bingo', 'lottery', 'roulette', 'domino', 'connect 4', 'connect four', 'battleship', 'tic tac toe', 'tic-tac-toe', 'maze', 'spot it', 'memory', 'puzzle', 'puzzles', 'sticker book', 'trivia', 'uno', 'waddingtons', 'bicycle', 'humanity', 'children', 'kids', 'toddler', 'educational', 'alphabet', 'orchard', 'thinkfun', 'bigjigs', 'kosmos', 'haba', 'lego', 'plastic', 'magnetic', 'sensory', 'novelty', 'unicorns', 'corn hole', 'foosball', 'football', 'puck game', 'ring toss', 'bag toss', 'whack mole', 'throw throw', 'prize wheel', 'raffle', 'game table cloth', 'date night', 'drinking game', 'drinking games', 'drink', 'drunk', 'game set', 'high quality', 'professional', 'performance', 'interactive', 'interaction', 'sex', 'intimate', 'intimacy', 'labia', 'dick', 'f**k', 'f***', 'f***?', 'hitler', 'lube', 'penis', 'meme', 'playing cards', 'afx', 'ak interactive', 'ptn', 'mancala', 'checkers', 'Pokémon Card', 'Pokémon Cards', 'Pokemon Card', 'Pokemon Cards', 'Mahjongg', 'Mah jong', 'Mah Jongg', 'Strapless', 'Remote', 'Video Game', 'Toy', 'Pub game', 'Number Balls', 'Blowjob', 'Bulk Family', 'Bulk games', 'Bulk boardgames', 'Bulk board games', 'Bulk lot', 'Sudoku', 'Cards Against', 'Citadels', 'Cluedo', 'Cooked Aussies', 'D & D', 'Disney', 'Gambling', 'Wooden Toss', 'Building Block', 'Building Blocks', 'Fidget', '30ML', 'Bottle Opener', 'Bubblegum', 'Buzzed', 'Buzzer', 'Darts', 'Dartboard', 'Board Toy', 'Ass', 'Dumb', 'Whack A Mole', 'Curling', 'Shuffleboard', 'Bible', 'Guess Who', 'Guess Who?', 'Kitty', 'Handbag', 'Hungry Hippos', 'Jumanji', 'Projector', 'Mouse Trap', 'Pictionary', '1000 Piece', '1000 Pieces', '1000-Piece', '1000-Pieces', '1000Piece', '1000Pieces', 'Pressure Washer', 'Psycho Killer', 'Psycho Killer:', 'Healing Crystal', 'Ridley\'s', 'Ridleys', 'Ridley', 'RISK', 'Santa', 'Christmas', 'WASJIG', 'Shut The Box', 'Smart Games', 'SmartGames', 'Flash Card', 'Flash Cards', 'Chameleon', 'Walking Dead', 'Washers', 'Trail by Trolley', 'Twister', 'Vampire', 'Velcro', 'Unmatched', 'Thomas', 'Runequest', 'Brimstone', 'Pokémon', 'Harry Potter', 'Gloomhaven', 'Final Girl', 'TCG', 'LCG', 'Zombicide', 'Lord of the Rings', 'Axis & Allies', 'One Piece', 'Paw Patrol', 'Adult', 'Arkham Horror', 'Basketball', 'Beat That', 'Blue Opal', 'Bluey', 'Bop It', 'Blood on the Clocktower', 'xHaba', 'Dragon Shield', 'Card Holder', 'Card Holders', 'Card Sleeve', 'Card Sleeves', 'Dice Cup', 'Dice Cups', 'Dice Tray', 'Dice Trays', 'Tablecloth', 'Carry Case', 'Carry Cases', 'Game Dice', 'Citadel', 'Folded Space', 'Storage Container', 'Gamegenic', 'Kingshield', 'LPG', 'MDG', 'Monument Pro', 'Ultra Pro', 'Ultimate Guard', 'Cushion', 'Pillow', 'Tangram', 'Paddle Ball', 'Four in a Row', 'Quoits', 'Cricket', 'Brain Teaser', 'Pub Quiz', 'Balancing Game', 'Noughts & Crosses', 'Murder Mystery', 'Game Prop', 'Game Props', 'Melissa & Doug', 'Matching Game', 'Twerk', 'Colouring Book', 'Coloring Book', 'Oracle Deck', 'Fortune Telling', 'Iron Clays', 'Tumbling Tower', 'Dice Pack', 'Reversible', 'Snakes and Ladders', 'Snakes & Ladders',
    // v0.7.14 added: "Snakes and Ladders" variants (Chutes/Shooters).
    'Shooters and Ladders', 'Shooters & Ladders', 'Shooters + Ladders',
    'Chutes and Ladders', 'Chutes & Ladders', 'Chutes + Ladders',
    'Cup Holders', 'Mathematics', 'Hot Wheels', 'Ten Pin Bowling', 'Newtons Cradle', 'Hedbanz', 'Conversation Cards',
    // v0.7.14 added: more conversation/dating-deck variants near
    // existing "Conversation Cards".
    'Conversation Starter', 'Conversation Starters', 'Couples Conversation',
    'Dating Game', 'Dating Games', 'Dating Card', 'Dating Cards', 'Blank Dice', 'Wooden Dice', '500pcs', 'Per Pack', 'Premium Sleeves', '1pc', '2pc', '3pc', '4pc', '5pc', '6pc', '7pc', '8pc', '9pc', '10pc', '1pcs', '2pcs', '3pcs', '4pcs', '5pcs', '6pcs', '7pcs', '8pcs', '9pcs', '10pcs', '15pc', '15pcs', '20pc', '20pcs', '25pc', '25pcs', '50pc', '50pcs', '100pc', '100pcs', '200pc', '200pcs', '250pc', '250pcs', '500pc',
    // v0.7.14 added: more bulk-quantity tokens alongside the existing Npc/Npcs sweep.
    '100 Pcs', '12Pcs', '40pcs', '50 Pack',
    '6 Nimmt!', 'Akumulate', 'Ping Pong', 'Photo Cards', 'Colorful Balls', 'Bachelorette', 'Microns', 'Waterproof', 'Stress Relief', 'Wooden Set', 'Magic Trick', 'Magical Trick', 'Road Trip', 'Crafts', 'Wooden Disc', 'Wooden Disk',
    // v0.7.14 added: misc novelty / non-board-game listings that
    // keep showing up in the corpus.
    'Clue Board Game', 'Clue BoardGame',
    'Pleasure',
    'Crazy Caterpillar',
    'Police Alert',
    'Dodgeball',
    'Rainbow Ball',
    'House Props',
    'Taboo',
    'AFL', 'NRL',
    '30 Seconds',
    '5 Second Rule',
    'LED',
    'Fun Family Game',
    'Playing Card', 'Playing Cards'
  ];

  // Build the blacklist regex from the keyword array. Entries are escaped
  // for safe use as regex alternation members, then joined with `|` and
  // wrapped in a leading `\b` anchor and a non-capturing group. The result
  // is functionally equivalent to writing `/\b(jigsaw|mahjong|...)/i` by
  // hand, but resilient to entries containing regex meta-characters
  // (`f**k`, `unlock!`, `connect 4` etc).
  const PURGE_TITLE_RX = (() => {
    const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alts = PURGE_TITLE_KEYWORDS.map(escapeForRegex).join('|');
    return new RegExp(`\\b(?:${alts})`, 'i');
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // Expansion detector (v0.7.11)
  // ─────────────────────────────────────────────────────────────────────────
  // Listings that survive PURGE_TITLE_RX are then run through this title
  // heuristic. A match sets `isExpansion: true` on the row; the website's
  // mode toggle uses it to power the Board Games / Expansions split.
  //
  // Rule:
  //   1. Title contains a standalone `Expansion` or `Expansions`
  //      (case-insensitive). If not → not an expansion.
  //   2. Otherwise we look at the substring of the title BEFORE the first
  //      `Expansion` match. If that prefix contains any of:
  //         "and"   "+"   "inc"   "inc."   "including"   "comes"
  //      …the listing is treated as a BASE GAME that happens to also
  //      include an expansion in the package — NOT an expansion-only
  //      listing — and isExpansion stays false.
  //   3. If the prefix has no qualifier word, isExpansion is true.
  //
  // Examples:
  //   "Wingspan Game and European Expansion"   → base game (and)
  //   "Catan + Seafarers Expansion"            → base game (+)
  //   "Concordia base game inc. expansion"     → base game (inc.)
  //   "Wingspan: European Expansion"           → expansion (no qualifier)
  //   "Brass Birmingham Expansion Pack"        → expansion (no qualifier)
  //
  // Like the accessory tagger this used to replace, this runs AFTER
  // PURGE_TITLE_RX, so it only ever fires on titles that have already
  // survived the blacklist.
  const EXPANSION_TRIGGER_RX     = /\bexpansions?\b/i;
  // Matches "and", "inc", "inc.", "including", "comes", or a literal "+".
  // \b alone won't anchor "+", so it's pulled out of the alternation.
  const BASE_GAME_QUALIFIER_RX   = /(?:\b(?:and|inc\.?|including|comes)\b|\+)/i;

  function detectIsExpansion(title) {
    if (!title) return false;
    const m = EXPANSION_TRIGGER_RX.exec(String(title));
    if (!m) return false;
    const prefix = String(title).slice(0, m.index);
    if (BASE_GAME_QUALIFIER_RX.test(prefix)) return false;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stale-listing reap threshold
  // ─────────────────────────────────────────────────────────────────────────
  // Listings whose `lastSeenAt` is older than this get deleted at the end
  // of every Quick Run / Full Fetch. TM listings have a 30-day max life,
  // so anything not re-encountered in 14 days is overwhelmingly likely to
  // be expired/sold/pulled. Bias is intentionally aggressive: a few false
  // positives (legitimate listings buried deep in pagination that we
  // happened to miss) is preferable to dead links accumulating in the
  // grid. Tune lower to be more aggressive, higher to be more lenient.
  const STALE_LISTING_DAYS = 14;

  // ---- Listings sampler -------------------------------------------------
  // Build a small representative sample of listings for committing
  // alongside the full listings.json. For each of the eight game/puzzle
  // subcategories the site walks, take up to 15 base-game listings and
  // 5 expansion listings as they appear in the snapshot — yielding a
  // ≤160-row structural cross-section for downstream debugging without
  // committing the full ~6k-row corpus to git or pasting it into a
  // Claude conversation.
  // v0.7.11: was 15 board-games + 5 accessories per subcat (Accessories
  // mode retired); now 15 base-games + 5 expansions per subcat so the
  // example file still covers both website view-mode code paths.
  const SAMPLE_SUBCATS = [
    'card-games',
    'childrens-games',
    'dice-games',
    'party-games',
    'strategy-war-games',
    'word-games',
    'other',                  // board-games/other
    'games-puzzles-other',    // top-level games-puzzles-tricks/other
  ];
  const SAMPLE_PER_SUBCAT_BASEGAMES  = 15;    // !isExpansion rows per subcat
  const SAMPLE_PER_SUBCAT_EXPANSIONS = 5;     //  isExpansion rows per subcat

  function buildListingsSample(listings) {
    grp('sample', `buildListingsSample: scanning ${listings.length.toLocaleString()} listings`);
    const t = startTimer();

    const out = [];
    const perSubcat = {};
    for (const subcat of SAMPLE_SUBCATS) {
      const inSubcat = listings.filter((l) => l && l.subcat === subcat);
      const expansions = inSubcat.filter((l) =>  l.isExpansion).slice(0, SAMPLE_PER_SUBCAT_EXPANSIONS);
      const baseGames  = inSubcat.filter((l) => !l.isExpansion).slice(0, SAMPLE_PER_SUBCAT_BASEGAMES);
      perSubcat[subcat] = {
        total:      inSubcat.length,
        baseGames:  baseGames.length,
        expansions: expansions.length,
      };
      out.push(...baseGames, ...expansions);
    }
    dbg('sample', 'per-subcat sample counts:', perSubcat);
    dbg('sample', `sample built: ${out.length} rows in ${t()}`);

    if (out.length === 0) {
      dbgWarn('sample', 'sample is EMPTY — every subcat returned 0 rows. Likely causes:');
      dbgWarn('sample', '  • the corpus is empty (no run has finished yet)');
      dbgWarn('sample', '  • subcat slugs in SAMPLE_SUBCATS no longer match what the crawler emits');
    }
    grpEnd();
    return out;
  }

  const ORIGIN = 'https://www.trademe.co.nz';

  const DEFAULT_SETTINGS = {
    politeDelayMs: 800,
    politeDelayJitterMs: 400,
    conditionFilter: 'all',             // 'new' | 'used' | 'all'
    sortOrder: 'expirydesc',
    maxConsecutiveFailures: 5,
    abortBackoffSec: 30,
    fetchTimeoutMs: 30000,
    maxPagesPerSubcat: 60,
    autoExportOnRunComplete: true,
  };

  // IndexedDB
  const DB_NAME = 'tm_bgbf';
  const DB_VERSION = 1;
  const STORE_LISTINGS  = 'listings';
  const STORE_META      = 'meta';

  // GM keys
  const GM_KEY_SETTINGS      = 'settings.v1';
  const GM_KEY_CURRENT_RUN   = 'currentRun.v1';
  // v0.7.14: panel checkbox for the optional listings-example.json export.
  // Stored as a plain boolean via GM_setValue/GM_getValue. Default false.
  const GM_KEY_EXPORT_SAMPLE = 'exportSampleEnabled';

// ============================================================================
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

  // ============================================================================
  // 3. UTILITIES
  // ============================================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function cleanLocationField(s) {
    if (s == null) return null;
    let cleaned = String(s);
    cleaned = cleaned.split(/\s*(?:Closes|Closing|Listed|Ends|Started|Closed)\b/i)[0];
    cleaned = cleaned.split(/[—–]/)[0];
    cleaned = cleaned.replace(/^[\s·•,|]+|[\s·•,|]+$/g, '').trim();
    return cleaned || null;
  }

  function getPath(obj, path) {
    if (obj == null) return undefined;
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function pickFirstArray(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (Array.isArray(v) && v.length > 0) return v;
    }
    for (const p of paths) {
      const v = getPath(obj, p);
      if (Array.isArray(v)) return v;
    }
    return null;
  }

  function pickFirstValue(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  /**
   * Last-resort fallback: walk the listing object for any key whose name
   * matches one of `keyNames` (case-insensitive, any depth up to maxDepth).
   * BFS so shallow matches win over deeper duplicates. Catches store-shape
   * Useful when an upstream data shape change buries an expected field
   * deeper inside the listing-card payload than the `pickFirstValue`
   * paths cover.
   */
  function findValueByKey(root, keyNames, maxDepth = 4) {
    if (!root || typeof root !== 'object') return undefined;
    const wanted = new Set(keyNames.map((k) => k.toLowerCase()));
    const visited = new WeakSet();
    const queue = [{ node: root, depth: 0 }];
    while (queue.length) {
      const { node, depth } = queue.shift();
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);
      if (depth > maxDepth) continue;
      if (!Array.isArray(node)) {
        for (const k of Object.keys(node)) {
          if (wanted.has(k.toLowerCase())) {
            const v = node[k];
            if (v != null && v !== '') return v;
          }
        }
      }
      if (Array.isArray(node)) {
        for (const v of node) if (v && typeof v === 'object') queue.push({ node: v, depth: depth + 1 });
      } else {
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (v && typeof v === 'object') queue.push({ node: v, depth: depth + 1 });
        }
      }
    }
    return undefined;
  }

  function nowIso() { return new Date().toISOString(); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function parsePriceDisplay(text) {
    if (text == null) return { numeric: null, label: null };
    const s = String(text).trim();
    if (!s) return { numeric: null, label: null };
    const numMatch = s.match(/\$\s*([\d,]+(?:\.\d+)?)/);
    let numeric = null;
    if (numMatch) {
      const n = Number(numMatch[1].replace(/,/g, ''));
      if (Number.isFinite(n)) numeric = n;
    }
    let label = null;
    if (numMatch && numMatch.index > 0) {
      label = s.slice(0, numMatch.index).trim().replace(/[:\-—–|,]+$/, '').trim() || null;
    } else if (!numMatch) {
      label = s;
    }
    return { numeric, label };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // politeSleep — anti-detection humanization (v0.7.14)
  // ─────────────────────────────────────────────────────────────────────────
  // Mean delay is preserved across a run; only the per-call DISTRIBUTION
  // changes vs the v0.7.13 fixed-mean+uniform-jitter scheme.
  //
  // Distribution. Let X = settings.politeDelayMs (default 800). Each call
  // draws delta = X * (avg(r1, r2, r3) * 2.4 - 0.2)  where rN ~ U(0,1).
  // The triangular-ish kernel `avg(r1,r2,r3)` has mean 0.5, so:
  //   E[delta] = X * (0.5 * 2.4 - 0.2)
  //            = X * (1.2 - 0.2)
  //            = X
  // and the support is [X*-0.2, X*2.2] which we clamp to [0.4·X, 1.6·X]
  // post-hoc — clamp tails are statistically rare (a triangular sum sits
  // tightly around the mean) so clamping has negligible effect on the
  // expected value. Net result: same mean as v0.7.13, much wider variance,
  // and a non-uniform shape that is harder to fingerprint than U(0, J).
  //
  // Human pauses. Once every HUMAN_PAUSE_FREQUENCY calls (≈1-in-32,
  // randomized so the cadence isn't itself periodic), emit a long pause of
  // 3×–6× X simulating the user getting distracted. The extra time is
  // tracked in `_politeSleepDebt` and offset by SHORTENING the next
  // HUMAN_PAUSE_COMPENSATION_REQUESTS (=3) sleeps proportionally, so the
  // running average across any window ≥ ~32 requests is unchanged. If a
  // compensated sleep would go negative we floor it at 50ms so we still
  // briefly yield to the event loop. The floor is small enough that the
  // residual drift across a typical 200-request run is well under 1%.
  //
  // No change here increases the AVERAGE delay between requests across a
  // run; the human-pause time is precisely accounted for and refunded by
  // the compensation pool.
  let _politeSleepDebt = 0;             // ms still owed (positive => shorten next sleeps)
  let _politeSleepCounter = 0;          // request counter for human-pause cadence
  let _politeSleepCompensationLeft = 0; // sleeps remaining over which to spread the debt

  async function politeSleep() {
    const s = settings.get();
    const X = s.politeDelayMs || 800;
    _politeSleepCounter++;

    // Triangular kernel, mean 0.5, scaled+shifted to mean=X with support
    // approximately [-0.2X, 2.2X] before clamping.
    const triKernel = (Math.random() + Math.random() + Math.random()) / 3;
    let delta = X * (triKernel * 2.4 - 0.2);

    // Clamp tails — triangular sums concentrate around the mean so this
    // trims a very small fraction of draws and barely shifts E[delta].
    const lo = X * 0.4;
    const hi = X * 1.6;
    if (delta < lo) delta = lo;
    if (delta > hi) delta = hi;

    // Inject a long human pause occasionally, randomized so the cadence
    // itself isn't periodic. When emitted, store the EXTRA time as debt to
    // be refunded across the next N sleeps.
    if (_politeSleepCompensationLeft === 0 &&
        _politeSleepCounter % HUMAN_PAUSE_FREQUENCY === 0 &&
        Math.random() < 0.5) {
      const mult = HUMAN_PAUSE_MULT_MIN + Math.random() * (HUMAN_PAUSE_MULT_MAX - HUMAN_PAUSE_MULT_MIN);
      const longPause = X * mult;
      _politeSleepDebt += (longPause - delta);  // EXTRA time vs the sleep we would have done
      _politeSleepCompensationLeft = HUMAN_PAUSE_COMPENSATION_REQUESTS;
      delta = longPause;
    } else if (_politeSleepCompensationLeft > 0 && _politeSleepDebt > 0) {
      // Refund: shorten this sleep by debt/remaining so the spread is even.
      const refund = _politeSleepDebt / _politeSleepCompensationLeft;
      delta -= refund;
      _politeSleepDebt -= refund;
      _politeSleepCompensationLeft--;
      if (delta < 50) delta = 50;  // tiny floor so we still yield
    }

    await sleep(delta);
  }

  // Fisher-Yates in-place shuffle. Used by 11-orchestrators.js to randomise
  // the (subcat × condition) pass order per run (v0.7.14 anti-detection).
  function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Pick a random element from an array. Used by 07-network.js to rotate
  // Accept-Language / Accept headers per-request.
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ============================================================================
  // 4. SETTINGS
  // ============================================================================

  const settings = (() => {
    let cache = null;
    function load() {
      try {
        const raw = GM_getValue(GM_KEY_SETTINGS, null);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch (e) {
        warn('settings load failed, using defaults', e);
        return { ...DEFAULT_SETTINGS };
      }
    }
    function save(next) {
      cache = { ...DEFAULT_SETTINGS, ...next };
      GM_setValue(GM_KEY_SETTINGS, JSON.stringify(cache));
      return cache;
    }
    return {
      get() { if (!cache) cache = load(); return cache; },
      save,
      reset() { cache = { ...DEFAULT_SETTINGS }; GM_setValue(GM_KEY_SETTINGS, JSON.stringify(cache)); return cache; },
    };
  })();

  // ============================================================================
  // 5. INDEXEDDB LAYER
  // ============================================================================

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_LISTINGS)) {
          // v0.7.10: trimmed to the only index actually used —
          // `subcat`. Removed memberId + classification (vestigial
          // since the v0.7.7 classifier removal) and endDate (TM
          // never populates this; verified null on 100 % of 7,223
          // production listings). Sellers + overrides stores
          // dropped entirely.
          const ls = db.createObjectStore(STORE_LISTINGS, { keyPath: 'listingId' });
          ls.createIndex('subcat', 'subcat', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbPut(storeName, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbBulkPut(storeName, values) {
    if (!values || !values.length) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const st = tx.objectStore(storeName);
      for (const v of values) st.put(v);
      tx.oncomplete = () => resolve(values);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbGet(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbGetAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbCount(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(storeName, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbDestroy() {
    if (dbPromise) { try { (await dbPromise).close(); } catch {} }
    dbPromise = null;
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => warn('db delete blocked');
    });
  }

  // ============================================================================
  // 6. NETWORK FETCHER
  // ============================================================================

  async function fetchHtml(url, opts = {}) {
    const s = settings.get();
    const { maxAttempts = 4, timeoutMs = s.fetchTimeoutMs || 30000 } = opts;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
      const t0 = Date.now();
      log(`fetchHtml attempt ${attempt}/${maxAttempts}: ${url}`);
      try {
        // v0.7.14: rotate Accept and Accept-Language across small NZ-plausible
        // pools per request so every fetch's header fingerprint isn't identical.
        const headers = {
          'Accept': pickRandom(ACCEPT_HEADER_POOL),
          'Accept-Language': pickRandom(ACCEPT_LANGUAGE_POOL),
        };
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (giving up)`);
        const text = await res.text();
        const elapsed = Date.now() - t0;
        if (/<title[^>]*>\s*(Just a moment|Attention Required|Access denied|Cloudflare)\b/i.test(text)) {
          warn(`fetchHtml challenge page detected after ${elapsed}ms for ${url}`);
          throw new Error('challenge-page-detected');
        }
        log(`fetchHtml OK in ${elapsed}ms, ${text.length} bytes`);
        return text;
      } catch (e) {
        clearTimeout(timer);
        const elapsed = Date.now() - t0;
        lastError = e;
        if (e && e.name === 'AbortError') {
          warn(`fetchHtml attempt ${attempt} TIMEOUT after ${elapsed}ms (limit ${timeoutMs}ms): ${url}`);
          lastError = new Error(`fetch-timeout-${timeoutMs}ms`);
        } else {
          warn(`fetchHtml attempt ${attempt} failed after ${elapsed}ms for ${url}:`, e.message || e);
        }
        if (e && e.message === 'challenge-page-detected') throw e;
        if (attempt < maxAttempts) {
          // v0.7.14: multiplicative jitter (×0.7..×1.4) instead of an
          // additive 0..500ms cap. E[multiplier] = 1.05 ≈ same expected
          // wait as the previous "+0..500" added to a 1500..30000 base
          // (which averaged ~250ms extra), but with proportionally-wider
          // spread so retries from many parallel runs don't cluster.
          const base = clamp(800 * Math.pow(2, attempt), 1500, 30000);
          const mult = 0.7 + Math.random() * 0.7;
          const backoff = base * mult;
          await sleep(backoff);
        }
      }
    }
    throw lastError || new Error('fetchHtml exhausted retries');
  }

  // ============================================================================
  // 7. EMBEDDED-DATA EXTRACTION
  // ============================================================================

  function parseHtml(html) { return new DOMParser().parseFromString(html, 'text/html'); }

  function extractNextData(doc) {
    const el = doc.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent); } catch (e) {
      warn('__NEXT_DATA__ parse failed', e);
      return null;
    }
  }

  function extractNextFlight(doc) {
    const scripts = [...doc.querySelectorAll('script')]
      .map((s) => s.textContent || '')
      .filter((t) => t.includes('self.__next_f.push'));
    if (!scripts.length) return null;
    const combined = scripts.join('\n');
    const re = /self\.__next_f\.push\(\[\s*\d+\s*,\s*"((?:\\.|[^"\\])*)"\s*\]\)/g;
    const buf = [];
    let m;
    while ((m = re.exec(combined)) !== null) {
      try { buf.push(JSON.parse('"' + m[1] + '"')); } catch {}
    }
    return buf.join('');
  }

  function findListingsInFlight(flow) {
    if (!flow) return [];
    const results = [];
    const seen = new Set();
    const re = /\{[^{}]{0,500}?["'](?:listingId|ListingId)["']\s*:\s*\d+[^{}]{0,5000}?\}/g;
    let m;
    while ((m = re.exec(flow)) !== null) {
      let depth = 0, start = m.index, i = start, end = -1;
      for (; i < flow.length && i < start + 20000; i++) {
        const c = flow[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end < 0) continue;
      const candidate = flow.slice(start, end);
      try {
        const obj = JSON.parse(candidate);
        const id = obj.listingId || obj.ListingId;
        if (id && !seen.has(id)) { seen.add(id); results.push(obj); }
      } catch {}
    }
    return results;
  }

  function findListingArraysInJson(root) {
    const found = [];
    const stack = [root];
    const visited = new WeakSet();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      if (visited.has(node)) continue;
      visited.add(node);
      if (Array.isArray(node)) {
        if (node.length && typeof node[0] === 'object' &&
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

  function scrapeDomCards(doc) {
    const out = [];
    const cards = doc.querySelectorAll('a[href*="/listing/"], [data-testid*="search-card"], [class*="search-card"]');
    const seen = new Set();
    cards.forEach((el) => {
      const a = el.tagName === 'A' ? el : el.querySelector('a[href*="/listing/"]');
      const href = a ? a.getAttribute('href') : null;
      const m = href && href.match(/\/listing\/(\d+)/);
      if (!m) return;
      const id = parseInt(m[1], 10);
      if (seen.has(id)) return;
      seen.add(id);
      const title = (el.querySelector('h3, [class*="title"]')?.textContent || a?.getAttribute('title') || '').trim();
      const priceText = (el.querySelector('[class*="price"]')?.textContent || '').trim();
      const regionRaw = (el.querySelector('[class*="location"], [class*="region"]')?.textContent || '').trim();
      const region = cleanLocationField(regionRaw);
      // v0.7.10: pictureHref + inTradePill extraction removed.
      // pictureHref was never requested and never used by the
      // website. inTradePill was a vestigial classifier signal
      // (Personal/Business detection retired in v0.7.7).
      out.push({
        listingId: id, title, priceDisplay: priceText, region,
      });
    });
    return out;
  }

  function extractListingsFromPage(html) {
    const doc = parseHtml(html);
    const nd = extractNextData(doc);
    if (nd) {
      const arr = findListingArraysInJson(nd);
      if (arr && arr.length) {
        const totalCount = pickFirstValue(nd, [
          'props.pageProps.totalCount', 'props.pageProps.searchResults.totalCount',
          'props.pageProps.results.totalCount', 'props.pageProps.listings.totalCount',
          'props.pageProps.searchResults.foundItems',
        ]);
        return { listings: arr, totalCount: totalCount ?? null, source: 'next-data' };
      }
    }
    const flow = extractNextFlight(doc);
    if (flow) {
      const arr = findListingsInFlight(flow);
      if (arr.length) return { listings: arr, totalCount: null, source: 'flight' };
    }
    const dom = scrapeDomCards(doc);
    if (dom.length) return { listings: dom, totalCount: null, source: 'dom' };
    return { listings: [], totalCount: null, source: 'none' };
  }

  // ============================================================================
  // 8. LISTING NORMALISER
  // ============================================================================

  // v0.7.10: the v0.7.1 endDate-probe diagnostic block was removed.
  // It conclusively proved that TradeMe's __NEXT_DATA__ doesn't
  // carry close-time data at all, so endDate has been retired
  // throughout. If TM ever changes that, restore the probe from
  // git history.

  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function bool(v) { return v === true || v === 'true' || v === 1; }

  function normaliseListing(raw, ctx = {}) {
    if (!raw) return null;
    const listingId = num(pickFirstValue(raw, ['listingId', 'ListingId', 'id']));
    if (!listingId) return null;

    const title = String(pickFirstValue(raw, ['title', 'Title', 'name']) || '').trim();

    const startPrice = num(pickFirstValue(raw, [
      'startPrice', 'StartPrice', 'currentBid', 'CurrentBid',
      'currentPrice', 'CurrentPrice', 'minimumNextBid', 'MinimumNextBid',
    ]));
    const buyNowPrice = num(pickFirstValue(raw, ['buyNowPrice', 'BuyNowPrice', 'buyNow', 'BuyNow']));
    const priceDisplay = pickFirstValue(raw, [
      'priceDisplay', 'PriceDisplay', 'displayPrice', 'DisplayPrice',
    ]);
    const parsedDisplay = parsePriceDisplay(priceDisplay);
    const priceNumeric = buyNowPrice ?? startPrice ?? parsedDisplay.numeric ?? null;
    let priceLabel = parsedDisplay.label;
    if (!priceLabel) {
      if (buyNowPrice != null && startPrice == null) priceLabel = 'Buy Now';
      else if (startPrice != null && buyNowPrice == null) priceLabel = 'Auction';
      else if (buyNowPrice != null && startPrice != null) priceLabel = 'Buy Now / Auction';
    }

    // v0.7.9: isClassified extraction dropped — see history.
    // v0.7.10: the standalone `isNew` capture and the condition
    // fallback below are gone too. The captured `isNew` field was
    // never read by anything; the fallback was only reachable if
    // ctx.condition was missing, which never happens on production
    // run paths (the bulk fetch always passes 'new' or 'used').
    // The diagnostic (`Diagnose extraction`) menu command hits the
    // no-context path and now just gets condition='unknown' — fine
    // for a debug dump.
    const hasBuyNow = buyNowPrice != null ? true : bool(pickFirstValue(raw, ['hasBuyNow', 'HasBuyNow']));

    const condition = (ctx.condition === 'new' || ctx.condition === 'used') ? ctx.condition : 'unknown';

    // v0.7.10: endDate extraction removed entirely. TradeMe's
    // __NEXT_DATA__ doesn't carry close-time data — verified by
    // the v0.7.1 probe that ran for several versions and never
    // matched any of the candidate field names.
    // v0.7.9: district + suburb extraction dropped — both came back
    // null on 100 % of 7,223 production listings. cleanLocationField
    // is still used for region.
    const regionRaw = pickFirstValue(raw, ['region', 'Region', 'regionName', 'RegionName']);
    const region    = cleanLocationField(regionRaw);

    // v0.7.0: the region purge (was a no-op since v0.4.0) is gone. The title
    // blacklist below remains the only fetch-time corpus filter.
    if (title && PURGE_TITLE_RX.test(title)) return null;

    const url = `${ORIGIN}/a/marketplace/listing/${listingId}`;

    // v0.7.10: dropped pictureHref (never used by the website),
    // endDate (always null), isNew (never read after capture),
    // and firstSeen/lastSeen (only consumer was the orphaned
    // delta-export feature, also removed in v0.7.10).
    return {
      listingId, title, subcat: ctx.subcat || null,
      startPrice, buyNowPrice, priceDisplay, priceNumeric, priceLabel,
      condition, hasBuyNow,
      region: region || null,
      url,
      // v0.7.11: expansion tag — set ONLY for surviving listings (the
      // blacklist purge above has already returned null for anything
      // in PURGE_TITLE_KEYWORDS, including the former accessory
      // keywords folded in for v0.7.11), so this only ever fires on
      // genuine board-game-domain listings.
      isExpansion: detectIsExpansion(title),
    };
  }



  // ============================================================================
  // 11. URL BUILDERS
  // ============================================================================

  function categoryUrl(path, page, opts = {}) {
    const s = settings.get();
    const params = new URLSearchParams();
    if ((opts.condition ?? s.conditionFilter) && (opts.condition ?? s.conditionFilter) !== 'all') {
      params.set('condition', opts.condition ?? s.conditionFilter);
    }
    if (page && page > 1) params.set('page', String(page));
    if ((opts.sortOrder ?? s.sortOrder)) params.set('sort_order', opts.sortOrder ?? s.sortOrder);
    const qs = params.toString();
    return `${ORIGIN}${path}${qs ? '?' + qs : ''}`;
  }

  function listingDetailUrl(listingId) { return `${ORIGIN}/a/marketplace/listing/${listingId}`; }

  // ============================================================================
  // 12. BULK RUN ORCHESTRATORS
  // ============================================================================

  const runState = {
    active: false, type: null, abortRequested: false,
    progress: { phase: 'idle', subcat: null, page: 0, totalSubcats: 0, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: '' },
    listeners: new Set(),
  };
  function emitRun() { for (const l of runState.listeners) { try { l(runState); } catch {} } }
  function setProgress(p) { runState.progress = { ...runState.progress, ...p }; emitRun(); }
  function onRun(fn) { runState.listeners.add(fn); return () => runState.listeners.delete(fn); }

  async function runFullFetch(opts = {}) {
    grp('run', `=== runFullFetch starting === (opts: ${JSON.stringify(opts)})`);
    const runT = startTimer();
    if (runState.active) {
      dbgWarn('run', 'a run is already active; ignoring this call');
      grpEnd();
      log('a run is already active; ignore');
      return;
    }
    runState.active = true;
    runState.type = 'full';
    runState.abortRequested = false;

    const cf = opts.condition ?? settings.get().conditionFilter ?? 'all';
    const conditionsToFetch = cf === 'all' ? ['new', 'used'] : [cf];
    const totalPasses = CATEGORIES.length * conditionsToFetch.length;

    setProgress({ phase: 'starting', subcat: null, page: 0, totalSubcats: totalPasses, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: 'Starting full fetch…' });

    const startedAt = nowIso();
    const cur = { runId: startedAt, type: 'full', startedAt, lastSubcatIndex: -1, lastPage: 0, complete: false };
    GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

    const seenListingIds = new Set();
    let consecutiveFailures = 0;
    let passIdx = 0;

    // v0.7.14 anti-detection: shuffle the OUTER (subcat × condition) pass
    // order per run so the request stream isn't deterministically top-down
    // through CATEGORIES on every run. Pagination WITHIN a pass remains
    // sequential — the v0.7.13 overflow short-circuit relies on that and
    // each pass's seenInPass set is local to that pass anyway. Each pair
    // is independent, so any ordering is safe. lastSubcatIndex is now the
    // ORIGINAL CATEGORIES index of the most-recently-completed pass; not
    // a position in the shuffled run order. There is no consumer of that
    // value (no resume logic), so the change is observational only.
    const passList = [];
    for (let i = 0; i < CATEGORIES.length; i++) {
      for (let j = 0; j < conditionsToFetch.length; j++) {
        passList.push({ sc: CATEGORIES[i], cond: conditionsToFetch[j], originalIndex: i });
      }
    }
    fisherYatesShuffle(passList);
    dbg('run', `Full Fetch pass order (shuffled): ${passList.map((p) => `${p.sc.slug}/${p.cond}`).join(', ')}`);

    try {
      for (let pIdx = 0; pIdx < passList.length; pIdx++) {
        if (runState.abortRequested) { setProgress({ phase: 'aborted', message: 'Aborted by user.' }); return; }
        const { sc, cond, originalIndex } = passList[pIdx];
        {
          const passLabel = conditionsToFetch.length > 1 ? `${sc.name} (${cond})` : sc.name;

          cur.lastSubcatIndex = originalIndex; cur.lastPage = 0;
          GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));
          log(`>>> Pass ${passIdx + 1}/${totalPasses}: ${passLabel} (path=${sc.path})`);
          setProgress({ phase: 'fetching', subcat: passLabel, page: 1, doneSubcats: passIdx, message: `Fetching ${passLabel}…` });

          let page = 1;
          let pagesTotalEstimate = null;
          const seenInPass = new Set();
          let pageSize = null;
          // v0.7.13: 2-consecutive all-repeat-page short-circuit for the
          // overflow case where TM keeps returning the last real page's
          // listings for page numbers past the real end. See Quick Run
          // for the rationale; reap invariant is preserved because every
          // listing on a page we DO process gets its lastSeenAt stamped.
          let consecutiveAllRepeats = 0;

          while (true) {
            if (runState.abortRequested) break;
            const url = categoryUrl(sc.path, page, { ...opts, condition: cond });
            let html;
            try { html = await fetchHtml(url); }
            catch (e) {
              consecutiveFailures++;
              setProgress({ errors: runState.progress.errors + 1, message: `Error on ${passLabel} p${page}: ${e.message}` });
              if (e.message === 'challenge-page-detected' || consecutiveFailures >= settings.get().maxConsecutiveFailures) {
                setProgress({ phase: 'aborted', message: 'Aborting: too many failures or challenge page.' });
                return;
              }
              await sleep(settings.get().abortBackoffSec * 1000);
              continue;
            }
            consecutiveFailures = 0;

            // v0.7.13: wrap the whole inner-loop body so any silent
            // rejection between fetchHtml and the next iteration
            // surfaces in the console instead of locking the UI.
            // Diagnostic-only; remove once the runFullFetch hang is
            // root-caused. See Issue 1 in commit message.
            try {
              const { listings, totalCount, source } = extractListingsFromPage(html);
              dbg('run', `${passLabel} p${page}: extractListingsFromPage returned ${listings.length} listings (totalCount=${totalCount}, source=${source})`);
              if (!listings.length) {
                if (page === 1) warn(`No listings on first page of ${sc.slug} (${cond}) via ${source}`);
                break;
              }
              if (page === 1 && totalCount && listings.length) {
                pageSize = listings.length;
                pagesTotalEstimate = Math.ceil(totalCount / pageSize);
              }

              const normalised = listings
                .map((r) => normaliseListing(r, { subcat: sc.slug, condition: cond }))
                .filter(Boolean);
              dbg('run', `${passLabel} p${page}: normalised ${normalised.length} of ${listings.length} rows`);

              const pageListingIds = new Set(normalised.map((n) => n.listingId));
              let alreadySeenCount = 0;
              for (const id of pageListingIds) if (seenInPass.has(id)) alreadySeenCount++;
              const allRepeats = pageListingIds.size > 0 && alreadySeenCount === pageListingIds.size;
              if (allRepeats) consecutiveAllRepeats++; else consecutiveAllRepeats = 0;

              let newOnThisPage = 0;
              for (const n of normalised) {
                if (!seenInPass.has(n.listingId)) {
                  seenInPass.add(n.listingId);
                  seenListingIds.add(n.listingId);
                  newOnThisPage++;
                }
              }

              const merged = [];
              const stamp = nowIso();
              for (const n of normalised) {
                const existing = await dbGet(STORE_LISTINGS, n.listingId);
                if (existing) merged.push({ ...existing, ...n, lastSeenAt: stamp });
                else merged.push({ ...n, lastSeenAt: stamp });
              }
              await dbBulkPut(STORE_LISTINGS, merged);
              dbg('run', `${passLabel} p${page}: dbBulkPut ${merged.length} listings resolved`);

              // v0.7.8: feed the per-pass scrape set + running tail
              // sentinel for the next Quick Run's expiration baseline.
              // Mirrors lines ~1217-1226 of runIncrementalFetch.
              const pk = passKeyOf(sc, cond);
              if (!currSeenByPass[pk]) currSeenByPass[pk] = new Set();
              for (const m of merged) {
                currSeenByPass[pk].add(m.listingId);
                tailByPass[pk] = { listingId: m.listingId, capturedAt: nowIso() };
              }
              dbg('run', `${passLabel} p${page}: currSeenByPass/tailByPass write done (pk=${pk}, set size=${currSeenByPass[pk].size})`);

              setProgress({
                page,
                listingsAccumulated: runState.progress.listingsAccumulated + newOnThisPage,
                message: `${passLabel} page ${page}: +${newOnThisPage} new (source=${source})${pagesTotalEstimate ? ` of ~${pagesTotalEstimate} pages` : ''}`,
              });
              dbg('run', `${passLabel} p${page}: setProgress done (newOnThisPage=${newOnThisPage}, allRepeats=${allRepeats}, consecutiveAllRepeats=${consecutiveAllRepeats})`);

              cur.lastPage = page;
              GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

              if (consecutiveAllRepeats >= 2) {
                dbg('run', `${passLabel} page ${page}: ${consecutiveAllRepeats} consecutive all-repeat pages — assuming overflow, ending pass`);
                break;
              }
              if (pagesTotalEstimate && page >= pagesTotalEstimate) break;
              if (totalCount && seenInPass.size >= totalCount) break;

              page++;
              const cap = settings.get().maxPagesPerSubcat || 60;
              if (page > cap) { warn(`safety cap: ${cap} pages on ${sc.slug} (${cond})`); break; }
              dbg('run', `${passLabel}: about to politeSleep before page ${page}`);
              await politeSleep();
              dbg('run', `${passLabel}: politeSleep returned, advancing to page ${page}`);
            } catch (loopErr) {
              err('run', `${passLabel} p${page}: unhandled error in page-loop body:`, loopErr && loopErr.message, loopErr);
              throw loopErr;
            }
          }

          passIdx++;
          setProgress({ doneSubcats: passIdx });
        }
      }

      dbg('run', `→ phase transition: crawl complete, entering seller-enrichment. listingsAccumulated=${runState.progress.listingsAccumulated}`);

      if (!runState.abortRequested) {
        dbg('run', '→ phase transition: crawl complete, entering post-process');
        setProgress({ phase: 'post-processing', message: 'Tidying up…' });
        await postProcessAll();

        // v0.7.12: lastSeenAt reap + content-based dedup. Same scheme
        // used by Quick Run. See reapAndDedup() near abortRun().
        const { reaped, dupesRemoved } = await reapAndDedup('Full Fetch');
        dbg('run', `Full Fetch cleanup: reaped=${reaped}, dupesRemoved=${dupesRemoved}`);
      }

      cur.complete = true;
      GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

      const lastFetchAt = nowIso();
      await dbPut(STORE_META, { key: 'lastFetchAt', value: lastFetchAt });
      await dbPut(STORE_META, { key: 'lastRunSummary', value: { ...cur, completedAt: lastFetchAt, listings: runState.progress.listingsAccumulated } });

      // v0.7.8: persist per-pass scrape sets + tails so the next
      // Quick Run has a complete expiration baseline to compare
      // against. Mirrors lines ~1288-1297 of runIncrementalFetch.
      const scrapeSetsForStorage = {};
      for (const [pk, set] of Object.entries(currSeenByPass)) {
        scrapeSetsForStorage[pk] = [...set];
      }
      await dbPut(STORE_META, { key: 'currSeenByPass.v1', value: scrapeSetsForStorage });
      await dbPut(STORE_META, { key: 'tailByPass.v1',     value: tailByPass });
      dbg('run', `Full Fetch: persisted scrape sets for next run: ${Object.keys(scrapeSetsForStorage).length} passes, tail sentinels recorded for ${Object.keys(tailByPass).length} passes`);

      setProgress({ phase: 'complete', message: `Done. ${runState.progress.listingsAccumulated} listings.` });

      if (settings.get().autoExportOnRunComplete) {
        setProgress({ message: 'Exporting…' });
        dbg('run', '→ phase transition: post-process complete, entering autoExport');
        await autoExport('full-fetch-complete');
        setProgress({ message: 'Export complete — listings.json downloaded.' });
      }
    } finally {
      runState.active = false;
      emitRun();
      dbg('run', `=== runFullFetch finished in ${runT()} (phase=${runState.progress.phase}, ` +
        `listings=${runState.progress.listingsAccumulated}, errors=${runState.progress.errors}) ===`);
      grpEnd(); // close 'run' group
    }
  }

  async function runIncrementalFetch() {
    if (runState.active) { log('a run is already active'); return; }
    runState.active = true;
    runState.type = 'incremental';
    runState.abortRequested = false;

    const cf = settings.get().conditionFilter ?? 'all';
    const conditionsToFetch = cf === 'all' ? ['new', 'used'] : [cf];
    const totalPasses = CATEGORIES.length * conditionsToFetch.length;

    setProgress({ phase: 'starting', subcat: null, page: 0, totalSubcats: totalPasses, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: 'Starting incremental fetch…' });

    // v0.7.6: snapshot the IDs known to IndexedDB BEFORE this run
    // begins. Any listing we encounter during the run whose ID is
    // not in this set is flagged isNewListing=true so the website
    // can render a red "NEW" badge.
    //
    // v0.7.10: BULK-CLEAR isNewListing on every existing record
    // up-front, before any pagination begins. Previously the
    // forward walk and tail-anchor sweep cleared the flag only
    // when they re-encountered a known listing — but Quick Run
    // stops the forward walk at the first all-known page, so any
    // listing on a page neither walk visits kept its stale
    // "NEW" badge from the previous run. Clearing up front makes
    // this run AUTHORITATIVE: by end of run, isNewListing=true
    // reflects exactly the listings genuinely new on this run,
    // and nothing else.
    const allKnown = await dbGetAll(STORE_LISTINGS);
    {
      const cleared = [];
      for (const l of allKnown) {
        if (l.isNewListing) {
          cleared.push({ ...l, isNewListing: false });
        }
      }
      if (cleared.length) {
        await dbBulkPut(STORE_LISTINGS, cleared);
        dbg('run', `Quick Run pre-clear: cleared isNewListing on ${cleared.length} previously-flagged record(s)`);
      } else {
        dbg('run', 'Quick Run pre-clear: no records had isNewListing=true to clear');
      }
    }

    // v0.7.12: per-pass scrape-set tracking has been removed. The old
    // tail-anchor / currSeenByPass scheme silently failed for every pass
    // where pagesTotalEstimate came back null (i.e., basically every
    // pass — see the v0.7.11 diagnostic logs that surfaced this). The
    // replacement is per-listing lastSeenAt tracking + a stale-record
    // reap at the end of the run; see reapAndDedup() and Diff 3 above.
    const knownIds = new Set(allKnown.map((l) => l.listingId));
    dbg('run', `Quick Run: ${knownIds.size.toLocaleString()} listing IDs known from previous runs`);
    let newThisRun = 0;
    let resurfacedThisRun = 0;   // already-known listings still visible — flag cleared
    let passIdx = 0;

    // v0.7.14: same anti-detection shuffle as runFullFetch — randomise the
    // (subcat × condition) outer pass order per run. See runFullFetch for
    // the rationale.
    const passList = [];
    for (let i = 0; i < CATEGORIES.length; i++) {
      for (let j = 0; j < conditionsToFetch.length; j++) {
        passList.push({ sc: CATEGORIES[i], cond: conditionsToFetch[j] });
      }
    }
    fisherYatesShuffle(passList);
    dbg('run', `Quick Run pass order (shuffled): ${passList.map((p) => `${p.sc.slug}/${p.cond}`).join(', ')}`);

    try {
      for (let pIdx = 0; pIdx < passList.length; pIdx++) {
        if (runState.abortRequested) break;
        const { sc, cond } = passList[pIdx];
        {
          const passLabel = conditionsToFetch.length > 1 ? `${sc.name} (${cond})` : sc.name;
          setProgress({ phase: 'fetching', subcat: passLabel, doneSubcats: passIdx, message: `Incremental: ${passLabel}` });

          let page = 1, stop = false;
          // v0.7.8: track pages-total so the tail-anchor sweep below
          // knows where the LAST page is. We previously discarded
          // totalCount because Quick Run had no use for it.
          let pagesTotalEstimate = null;
          let pageSize = null;
          // v0.7.13: track listing IDs we've already lastSeenAt-stamped
          // on this pass so we can detect the TM "overflow" case where
          // pages past the real end re-render the last real page's
          // listings. Two consecutive all-repeat pages → break. Reap
          // invariant is preserved because every listing on a page we
          // process IS stamped (we only short-circuit AFTER stamping).
          const seenInPass = new Set();
          let consecutiveAllRepeats = 0;
          while (!stop) {
            if (runState.abortRequested) break;
            const url = categoryUrl(sc.path, page, { sortOrder: 'expirydesc', condition: cond });
            let html;
            try { html = await fetchHtml(url); }
            catch (e) { setProgress({ errors: runState.progress.errors + 1, message: `Error: ${e.message}` }); break; }
            const { listings, totalCount } = extractListingsFromPage(html);
            if (!listings.length) break;
            if (page === 1 && totalCount && listings.length) {
              pageSize = listings.length;
              pagesTotalEstimate = Math.ceil(totalCount / pageSize);
            }

            const normalised = listings
              .map((raw) => normaliseListing(raw, { subcat: sc.slug, condition: cond }))
              .filter(Boolean);

            const pageListingIds = new Set(normalised.map((n) => n.listingId));
            let alreadySeenCount = 0;
            for (const id of pageListingIds) if (seenInPass.has(id)) alreadySeenCount++;
            const allRepeats = pageListingIds.size > 0 && alreadySeenCount === pageListingIds.size;
            if (allRepeats) consecutiveAllRepeats++; else consecutiveAllRepeats = 0;

            let newCount = 0;
            const recs = [];
            const stamp = nowIso();
            for (const n of normalised) {
              seenInPass.add(n.listingId);
              if (knownIds.has(n.listingId)) {
                // Already in DB. isNewListing was bulk-cleared on every
                // record at run start, so the merge here refreshes
                // price/title/etc. and stamps lastSeenAt so the
                // post-run reap leaves it alone.
                const existing = await dbGet(STORE_LISTINGS, n.listingId);
                if (existing) {
                  recs.push({ ...existing, ...n, lastSeenAt: stamp });
                  resurfacedThisRun++;
                }
                continue;
              }
              knownIds.add(n.listingId);
              recs.push({ ...n, isNewListing: true, lastSeenAt: stamp });
              newCount++;
              newThisRun++;
            }

            if (recs.length) await dbBulkPut(STORE_LISTINGS, recs);

            setProgress({ page, listingsAccumulated: runState.progress.listingsAccumulated + newCount, message: `${passLabel} p${page}: ${newCount} new` });
            // v0.7.12: NO early-stop on newCount === 0. Every page in the
            // pass paginates so every active listing's lastSeenAt gets
            // refreshed — that's what makes the post-run reap able to
            // identify expired listings reliably. Loop now exits via the
            // `if (!listings.length) break;` above (true end of
            // pagination), the v0.7.13 all-repeat short-circuit below,
            // or the safety cap below.
            if (consecutiveAllRepeats >= 2) {
              dbg('run', `${passLabel} page ${page}: ${consecutiveAllRepeats} consecutive all-repeat pages — assuming overflow, ending pass`);
              break;
            }
            page++;
            if (page > 50) break;
            await politeSleep();
          }

          passIdx++;
          setProgress({ doneSubcats: passIdx });
        }
      }

      if (!runState.abortRequested) {
        // v0.7.12: per-listing lastSeenAt reap + content-based dedup.
        // Replaces the old per-pass tail-anchor sweep + currSeenByPass
        // expiration comparison, which silently failed for every pass
        // where extractListingsFromPage's totalCount came back null.
        // See reapAndDedup() definition near abortRun().
        const { reaped, dupesRemoved } = await reapAndDedup('Quick Run');
        dbg('run', `Quick Run cleanup: reaped=${reaped}, dupesRemoved=${dupesRemoved}`);

        await postProcessAll();
        await dbPut(STORE_META, { key: 'lastFetchAt', value: nowIso() });
      }

      dbg('run', `Quick Run summary: ${newThisRun.toLocaleString()} new listings flagged isNewListing=true, ${resurfacedThisRun.toLocaleString()} previously-known listings refreshed (isNewListing cleared)`);

      setProgress({ phase: 'complete', message: `Incremental done. +${runState.progress.listingsAccumulated} new.` });

      if (settings.get().autoExportOnRunComplete) {
        setProgress({ message: 'Exporting…' });
        await autoExport('incremental-fetch-complete');
        setProgress({ message: 'Export complete — listings.json downloaded.' });
      }
    } finally {
      runState.active = false;
      emitRun();
    }
  }

  async function abortRun() {
    runState.abortRequested = true;
    setProgress({ message: 'Abort requested…' });
  }

  // v0.7.12: shared post-run cleanup. Called by both Quick Run and Full
  // Fetch after their main pagination loop finishes. Two passes:
  //
  //   1) lastSeenAt reap — delete any listing whose `lastSeenAt` field is
  //      older than STALE_LISTING_DAYS, OR is missing entirely (the
  //      latter only happens on the first run after upgrading from
  //      v0.7.11 or earlier; after that, every active listing should
  //      always have a fresh stamp).
  //
  //   2) Content-based dedup — group by (title|price|condition|region|
  //      subcat) and, in any group with >1 entry, keep the highest
  //      listingId (TM IDs are sequential, so the highest is the
  //      most recent relisting) and delete the rest.
  //
  // Returns { reaped, dupesRemoved } for the caller to log.
  async function reapAndDedup(label) {
    setProgress({ message: 'Checking for stale listings…' });
    const all = await dbGetAll(STORE_LISTINGS);
    const cutoffMs = Date.now() - (STALE_LISTING_DAYS * 24 * 60 * 60 * 1000);
    const stale = [];
    for (const l of all) {
      const seenMs = l.lastSeenAt ? new Date(l.lastSeenAt).getTime() : 0;
      if (seenMs < cutoffMs) stale.push(l.listingId);
    }
    for (const id of stale) await dbDelete(STORE_LISTINGS, id);
    dbg('run', `${label}: lastSeenAt reap removed ${stale.length} listing(s) unseen for >${STALE_LISTING_DAYS} days`);

    setProgress({ message: 'Deduplicating relisted items…' });
    const remaining = await dbGetAll(STORE_LISTINGS);
    const matchKey = (l) =>
      `${(l.title || '').trim().toLowerCase()}|` +
      `${l.priceNumeric ?? ''}|` +
      `${l.condition ?? ''}|` +
      `${l.region ?? ''}|` +
      `${l.subcat ?? ''}`;
    const groups = new Map();
    for (const l of remaining) {
      const key = matchKey(l);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }
    let dupesRemoved = 0;
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      // Highest listingId wins — TM IDs are monotonic, so the largest
      // is the most recent relisting. Older entries with identical
      // content get deleted.
      group.sort((a, b) => b.listingId - a.listingId);
      for (let i = 1; i < group.length; i++) {
        await dbDelete(STORE_LISTINGS, group[i].listingId);
        dupesRemoved++;
      }
    }
    dbg('run', `${label}: content-dedup removed ${dupesRemoved} duplicate-content listing(s) (relistings under new IDs)`);

    return { reaped: stale.length, dupesRemoved };
  }

  // ============================================================================
  // 14. POST-PROCESS
  // ============================================================================

  // v0.7.7: was reclassifyAll(). The Personal/Business classification
  // pipeline has been removed entirely; this function now exists
  // solely to do the non-classification housekeeping that used to ride
  // along with the reclassify pass:
  //   • title-blacklist purge (PURGE_TITLE_RX)
  //   • expansion re-tagging (detectIsExpansion)         (v0.7.11: was accessory re-tagging)
  //   • region whitespace cleaning            (v0.7.9: district + suburb removed)
  //   • backfilling priceNumeric / priceLabel from priceDisplay if a
  //     listing arrived without them
  //   • v0.7.11 legacy-field stripping: `isAccessory` left over from
  //     pre-v0.7.11 records gets deleted in place along with the
  //     pre-existing v0.7.10 strip list (firstSeen, lastSeen, endDate,
  //     pictureHref, isNew, isClassified, district, suburb, memberId,
  //     nickname, classification). This makes the "🧹 Re-purge"
  //     command a one-shot upgrade tool too: run it once after
  //     installing v0.7.11 and IndexedDB is clean.
  // It is called at the end of every full and incremental run, and
  // by the "Re-purge existing data" menu command.
  async function postProcessAll() {
    let listings = await dbGetAll(STORE_LISTINGS);

    // ---- Title-blacklist purge ----------------------------------------
    const purgeIds = [];
    for (const l of listings) {
      if (l.title && PURGE_TITLE_RX.test(String(l.title))) {
        purgeIds.push(l.listingId);
      }
    }
    if (purgeIds.length) {
      log(`Purging ${purgeIds.length} listings (title-blacklist match)`);
      for (const id of purgeIds) await dbDelete(STORE_LISTINGS, id);
      const removed = new Set(purgeIds);
      listings = listings.filter((l) => !removed.has(l.listingId));
    }

    // ---- Re-tag expansion status -------------------------------------
    // v0.7.11: was a re-tag of isAccessory. The accessory partition
    // has been retired (its keywords moved into PURGE_TITLE_KEYWORDS,
    // dropping those listings entirely at fetch time); the expansion
    // partition replaces it. Re-running this on every postProcess pass
    // means a future tweak to detectIsExpansion's heuristic propagates
    // to the existing IndexedDB corpus the moment the user invokes the
    // "🧹 Re-purge" menu command — no need to refetch.
    for (const l of listings) {
      l.isExpansion = detectIsExpansion(l.title);
    }

    // ---- Whitespace + price housekeeping + legacy-field strip -------
    const LEGACY_FIELDS = [
      // v0.7.9 removals
      'district', 'suburb', 'isClassified',
      // v0.7.10 removals
      'firstSeen', 'lastSeen', 'endDate', 'pictureHref', 'isNew',
      // v0.7.11 removal — Accessories partition retired; the field is
      // explicitly deleted so re-purging an existing IndexedDB corpus
      // doesn't leave stale isAccessory values floating in records.
      'isAccessory',
      // even-older classifier vestiges
      'memberId', 'nickname', 'classification',
    ];
    for (const l of listings) {
      const cleanedR = cleanLocationField(l.region);
      if (cleanedR !== l.region) l.region = cleanedR;
      for (const f of LEGACY_FIELDS) {
        if (l[f] !== undefined) delete l[f];
      }

      if (l.priceNumeric == null || l.priceLabel == null) {
        const parsed = parsePriceDisplay(l.priceDisplay);
        if (l.priceNumeric == null) l.priceNumeric = l.buyNowPrice ?? l.startPrice ?? parsed.numeric ?? null;
        if (l.priceLabel == null) {
          let lbl = parsed.label;
          if (!lbl) {
            if      (l.buyNowPrice != null && l.startPrice  == null) lbl = 'Buy Now';
            else if (l.startPrice  != null && l.buyNowPrice == null) lbl = 'Auction';
            else if (l.buyNowPrice != null && l.startPrice  != null) lbl = 'Buy Now / Auction';
          }
          l.priceLabel = lbl || null;
        }
      }
    }

    await dbBulkPut(STORE_LISTINGS, listings);
    dbg('run', `postProcessAll done: ${listings.length.toLocaleString()} listings retained, ${purgeIds.length.toLocaleString()} purged on title blacklist`);
  }

  // ============================================================================
  // 15. EXPORT — JSON IS PRIMARY, CSV IS A BACKUP
  // ============================================================================

  function downloadFile(name, mime, content) {
    grp('download', `downloadFile("${name}", ${mime}, ${content.length.toLocaleString()} chars)`);
    const sizeKB = (content.length / 1024).toFixed(1);
    dbg('download', `payload size: ${content.length.toLocaleString()} chars (~${sizeKB} KB)`);
    try {
      const blob = new Blob([content], { type: mime });
      dbg('download', `Blob constructed: type="${blob.type}", size=${blob.size}`);
      const url = URL.createObjectURL(blob);
      dbg('download', `Object URL created: ${url}`);

      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      dbg('download', `<a> appended to body, dispatching click()`);
      a.click();
      dbg('download', `click() dispatched — browser should now save "${name}"`);
      dbg('download', '⚠️  If you see no download appear: Chrome is most likely silently blocking');
      dbg('download', '   multi-file downloads from trademe.co.nz. Click the address-bar download');
      dbg('download', '   icon and choose "Always allow", or visit chrome://settings/content/automaticDownloads.');

      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
        dbg('download', `cleaned up object URL + anchor for "${name}"`);
      }, 1000);
    } catch (e) {
      dbgErr('download', `downloadFile threw for "${name}":`, e);
      grpEnd();
      throw e;
    }
    grpEnd();
  }

 // v0.7.7: project a stored listing down to the slim shape the
  // website actually consumes. Update this list when adding a new
  // user-facing field.
  //
  // Output schema (as of v0.7.11; schemaVersion bumped 6 → 7):
  //   listingId, title, subcat, condition, isExpansion, isNewListing,
  //   priceNumeric, priceDisplay, priceLabel, hasBuyNow, region, url
  //
  // v0.7.11 changes vs the v0.7.10 schema (schemaVersion 6):
  //   • isAccessory REMOVED — the Accessories view-mode has been
  //     retired and accessory keywords were folded into
  //     PURGE_TITLE_KEYWORDS, so those listings no longer reach the
  //     export. The website's normaliseImportedListing now reads
  //     isExpansion in its place (also defaults to false on legacy
  //     snapshots that pre-date this version).
  //   • isExpansion ADDED — set by detectIsExpansion at normalise
  //     time, used by the website's "Board Games" / "Expansions"
  //     mode toggle.
  //
  // To restore any of the dropped fields: re-add the line below AND
  // restore the extraction in normaliseListing.

  function slimListingForExport(l) {
    return {
      listingId:      l.listingId,
      title:          l.title,
      subcat:         l.subcat,
      condition:      l.condition,
      isExpansion:    !!l.isExpansion,
      isNewListing:   !!l.isNewListing,
      priceNumeric:   l.priceNumeric,
      priceDisplay:   l.priceDisplay,
      priceLabel:     l.priceLabel,
      hasBuyNow:      !!l.hasBuyNow,
      region:         l.region,
      url:            l.url,
    };
  }

  /**
   * The web-app-friendly export. JSON. Includes everything the static site
   * needs: listings + meta. Versioned so the static site can detect
   * schema mismatches. Sellers + overrides stores were dropped from the
   * blob in v0.7.7 along with the classifier removal.
   *
   * v0.7.6: every step traced via the new `dbg('export', …)` helpers, the
   * sample download now uses a 1.5 s gap (up from 0.5 s) to avoid Chrome's
   * silent multi-download blocker, and a sample of zero rows now emits a
   * visible warning instead of a silent empty file.
   */
  async function exportJsonForWebapp(reason = 'manual') {
    grp('export', `=== exportJsonForWebapp("${reason}") ===`);
    const totalT = startTimer();

    dbg('export', 'reading IndexedDB stores…');
    const dbT = startTimer();
    const fullListings = await dbGetAll(STORE_LISTINGS);
    const listings = fullListings.map(slimListingForExport);
    dbg('export', `slimmed export shape: ${fullListings.length.toLocaleString()} listings → ${Object.keys(slimListingForExport(fullListings[0] || {})).length} fields per row`);
    const meta = await dbGetAll(STORE_META);
    dbg('export', `IndexedDB read complete in ${dbT()}: ` +
      `${listings.length.toLocaleString()} listings, ${meta.length.toLocaleString()} meta entries`);

    const blob = {
      version: VERSION,
      schemaVersion: 7,        // v0.7.11: isAccessory removed, isExpansion added; accessory keywords folded into PURGE_TITLE_KEYWORDS
      exportedAt: nowIso(),
      reason,
      stats: {
        listings: listings.length,
      },
      listings, meta,
    };
    dbg('export', 'blob constructed:', {
      version:       blob.version,
      schemaVersion: blob.schemaVersion,
      exportedAt:    blob.exportedAt,
      reason:        blob.reason,
      stats:         blob.stats,
    });

    // v0.5.0: Filename is plain "listings.json" so it can be moved straight
    // into the static site's data/ folder without renaming. The static site
    // auto-loads ./data/listings.json on startup.
    const filename = 'listings.json';
    const stringifyT = startTimer();
    const fullJson = JSON.stringify(blob, null, 2);
    dbg('export', `JSON.stringify (full): ${fullJson.length.toLocaleString()} chars in ${stringifyT()}`);

    dbg('export', `triggering download #1 → "${filename}"`);
    downloadFile(filename, 'application/json', fullJson);

    // ---- Also emit listings-example.json (structural reference) ----
    // Same envelope as the full export, just a 160-listing cross-section
    // so the file shape stays current without git-committing the multi-MB
    // full corpus. v0.7.14: gated behind the panel checkbox "Also export
    // listings-example.json (sample)" — when unchecked, this whole block
    // is skipped (no buildListingsSample call, no 1500ms gap sleep, no
    // second downloadFile invocation). The full listings.json above is
    // unconditional.
    let sampleEmitted = false;
    if (!isExportSampleEnabled()) {
      dbg('export', 'sample export disabled by panel checkbox — skipping listings-example.json');
    } else {
    grp('sample', '--- emitting listings-example.json ---');
    try {
      const sampleListings = buildListingsSample(listings);
      const sampleObj = {
        ...blob,
        reason: 'sample',
        stats: { ...blob.stats, listings: sampleListings.length },
        listings: sampleListings,
      };
      const sampleJson = JSON.stringify(sampleObj, null, 2);
      const sampleSizeKB = (sampleJson.length / 1024).toFixed(1);
      dbg('sample', `sample envelope: ${sampleListings.length} listings, ` +
        `${sampleJson.length.toLocaleString()} chars (~${sampleSizeKB} KB)`);

      if (sampleListings.length === 0) {
        dbgWarn('sample', '⚠️  Sample contains 0 listings — the file will be effectively empty.');
        dbgWarn('sample', '   Continuing anyway so the file still gets written for diagnosis.');
      }

      // v0.7.6: bumped from 500ms → 1500ms. Chrome's heuristic for
      // "is this site auto-downloading multiple files?" is sensitive to
      // tight timing. With 500ms the second download was being silently
      // dropped on trademe.co.nz; 1500ms reliably lands in a fresh task
      // and the click is honoured. If it's still being blocked despite
      // this gap, the user needs to allow multi-downloads at:
      //   chrome://settings/content/automaticDownloads
      const SAMPLE_DOWNLOAD_DELAY_MS = 1500;
      dbg('sample', `waiting ${SAMPLE_DOWNLOAD_DELAY_MS}ms before second download to dodge Chrome's multi-download blocker…`);
      await new Promise((r) => setTimeout(r, SAMPLE_DOWNLOAD_DELAY_MS));

      dbg('sample', 'triggering download #2 → "listings-example.json"');
      downloadFile('listings-example.json', 'application/json', sampleJson);
      sampleEmitted = true;
      dbg('sample', '✅ listings-example.json download dispatched. ' +
        'If no file appeared, check Chrome\'s download blocker (see download category logs).');
    } catch (e) {
      dbgErr('sample', 'sample emit FAILED — main listings.json is still safe:', e);
    } finally {
      grpEnd(); // close 'sample' group
    }
    }

    log(`Exported ${listings.length} listings to ${filename} (${reason})${sampleEmitted ? ' + sample' : ''}`);
    const exportedAt = nowIso();
    await dbPut(STORE_META, { key: 'lastExportAt', value: exportedAt });
    try { localStorage.setItem('bgbf.lastExportAt', exportedAt); } catch (e) { /* ignore */ }
    dbg('export', `bookkeeping done: lastExportAt=${exportedAt}`);
    dbg('export', `=== exportJsonForWebapp finished in ${totalT()} ===`);
    grpEnd(); // close 'export' group
    return filename;
  }

  /**
   * Triggered automatically at the end of full or incremental runs (when
   * autoExportOnRunComplete is on). v0.7.10 simplified this from a
   * multi-format dispatcher to "always exports JSON" — exportCsv was
   * removed (unused) and exportDeltaOnly was removed (the website
   * always rejected delta exports).
   */
  async function autoExport(reason) {
    grp('export', `autoExport(reason="${reason}")`);
    try {
      dbg('export', '→ autoExport: running exportJsonForWebapp');
      await exportJsonForWebapp(reason);
      dbg('export', '✅ autoExport complete');
    } catch (e) {
      dbgErr('export', '❌ autoExport threw:', e);
      throw e;
    } finally {
      grpEnd();
    }
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const blob = JSON.parse(text);
        if (blob.listings)  await dbBulkPut(STORE_LISTINGS,  blob.listings);
        if (blob.meta) for (const m of blob.meta) await dbPut(STORE_META, m);
        await postProcessAll();
        await refreshPanelStatus();
        alert(`Imported ${blob.listings?.length || 0} listings.`);
      } catch (e) { alert('Import failed: ' + e.message); }
    });
    input.click();
  }

  // ============================================================================
  // 16. MINIMAL UI — Shadow DOM, just status + 4 buttons
  // ============================================================================

  let uiHost = null;
  let uiShadow = null;

  const UI_CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #fab {
      position: fixed; right: 16px; bottom: 16px;
      width: 52px; height: 52px; border-radius: 26px;
      background: #c0392b; color: #fff; border: 2px solid #fff; cursor: pointer;
      font-size: 22px; box-shadow: 0 2px 12px rgba(0,0,0,.4);
      z-index: 2147483647;
    }
    #fab:hover { background: #a83228; }
    #fab.flash { animation: bgbf-flash 1.2s ease-out 2; }
    @keyframes bgbf-flash {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); box-shadow: 0 0 0 12px rgba(192,57,43,.3); }
      100% { transform: scale(1); }
    }
    #toast {
      position: fixed; right: 16px; top: 16px;
      background: #27ae60; color: #fff; padding: 10px 14px;
      border-radius: 6px; font-size: 13px; font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 2147483647;
      animation: bgbf-toast 4s ease-out forwards;
    }
    @keyframes bgbf-toast {
      0% { transform: translateY(-20px); opacity: 0; }
      10% { transform: translateY(0); opacity: 1; }
      85% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-20px); opacity: 0; }
    }
    #panel {
      position: fixed; right: 16px; bottom: 76px;
      width: 320px; max-height: 80vh; overflow: auto;
      background: #fff; color: #222; border: 1px solid #ddd; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
      padding: 12px; font-size: 13px;
    }
    #panel header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    #panel header strong { font-size: 14px; }
    #panel-version { font-size: 11px; color: #888; }
    #panel-close { margin-left: auto; background: none; border: none; font-size: 20px; cursor: pointer; color: #666; }
    #status { background: #fafafa; padding: 8px; border-radius: 6px; margin-bottom: 10px; }
    .kv { display: flex; justify-content: space-between; padding: 2px 0; }
    .kv span:first-child { color: #666; }
    #run-bar { margin-top: 8px; }
    #run-msg { font-size: 12px; color: #444; margin-bottom: 4px; min-height: 1.2em; }
    #run-progress { width: 100%; }
    #actions, #actions2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    #options { display: flex; align-items: center; gap: 6px; padding: 6px 4px; margin-bottom: 6px; font-size: 12px; }
    #options label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .btn { padding: 8px 10px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #f5f5f5; }
    .btn.primary { background: #2980b9; color: #fff; border-color: #2980b9; }
    .btn.primary:hover { background: #246993; }
    .btn.danger { background: #e74c3c; color: #fff; border-color: #e74c3c; }
    .btn.danger:hover { background: #c0392b; }
    .btn.warn { background: #f39c12; color: #fff; border-color: #f39c12; }
    .btn-with-info { display: flex; align-items: center; gap: 6px; }
    .btn-with-info .btn { flex: 1; }
    .info-tip {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; flex: 0 0 16px;
      border-radius: 50%; background: #95a5a6; color: #fff;
      font-size: 10px; font-weight: 700; cursor: help;
      user-select: none; line-height: 1;
    }
    .info-tip:hover { background: #7f8c8d; }
    /* Tooltip is a real element rendered at the shadow-root level, OUTSIDE
       #panel, so it is not clipped by the panel's overflow:auto. Positioned
       at runtime by setupInfoTips() using getBoundingClientRect on the
       trigger \`?\` icon. */
    .floating-tip {
      position: fixed;
      left: -9999px; top: -9999px;
      background: #1a242f; color: #ecf0f1;
      padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.35;
      white-space: normal; width: max-content; max-width: 240px;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
      pointer-events: none;
      opacity: 0; visibility: hidden;
      transition: opacity .12s;
      z-index: 2147483647;
    }
    .floating-tip.visible { opacity: 1; visibility: visible; }
    footer { font-size: 10px; color: #888; text-align: center; margin-top: 6px; }
  `;

  function ensureUI() {
    if (uiShadow) return uiShadow;
    uiHost = document.createElement('div');
    uiHost.id = 'tm-bgbf-host';
    uiHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    document.documentElement.appendChild(uiHost);
    uiShadow = uiHost.attachShadow({ mode: 'open' });
    uiShadow.innerHTML = `
      <style>${UI_CSS}</style>
      <div id="root">
        <div id="toast">✅ Board Games Bulk Fetcher Collector loaded (v${VERSION})</div>
        <button id="fab" class="flash" title="Board Games Bulk Fetcher (Collector)">🎲</button>
        <div id="panel" hidden>
          <header>
            <strong>Board Games Collector</strong>
            <span id="panel-version">v${VERSION}</span>
            <button id="panel-close" title="Close">×</button>
          </header>
          <section id="status">
            <div class="kv"><span>Listings stored:</span><span id="kv-listings">…</span></div>
            <div class="kv"><span>Last fetch:</span><span id="kv-last-fetch">never</span></div>
            <div class="kv"><span>Last export:</span><span id="kv-last-export">never</span></div>
            <div id="run-bar" hidden>
              <div id="run-msg">…</div>
              <progress id="run-progress" max="100" value="0"></progress>
              <button id="run-abort" class="btn warn">Abort</button>
            </div>
          </section>
          <section id="actions">
            <span class="btn-with-info">
              <button id="act-incremental" class="btn primary">Quick run</button>
              <span class="info-tip" data-tip="Fetches only listings new since the last run. Fast incremental update — typically under a minute. Auto-exports listings.json at the end.">?</span>
            </span>
            <span class="btn-with-info">
              <button id="act-full" class="btn">Run full fetch</button>
              <span class="info-tip" data-tip="Walks every category from page 1, refreshing all listings. Slow — 10–30 minutes. Use after schema changes or to seed a fresh database.">?</span>
            </span>
          </section>
          <section id="actions2">
            <span class="btn-with-info">
              <button id="act-export" class="btn">Export JSON now</button>
              <span class="info-tip" data-tip="Exports the current IndexedDB contents as listings.json without running a fetch first. Useful for re-exporting unchanged data.">?</span>
            </span>
            <span class="btn-with-info">
              <button id="act-clear" class="btn danger">Clear all data…</button>
              <span class="info-tip" data-tip="Wipes the entire local IndexedDB. Cannot be undone. The next run will start from a blank corpus.">?</span>
            </span>
          </section>
          <section id="options">
            <label>
              <input type="checkbox" id="opt-export-sample" />
              Also export listings-example.json (sample)
            </label>
            <span class="info-tip" data-tip="When ticked, also auto-downloads listings-example.json (a 160-row balanced sample) at the end of every run. Useful for sharing the schema without dumping the whole corpus.">?</span>
          </section>
          <footer>
            JSON auto-downloads at end of every run. Drop into the static web app to browse.
          </footer>
        </div>
        <div id="floating-tip" class="floating-tip" role="tooltip"></div>
      </div>
    `;
    wirePanel();
    setupInfoTips();
    const toast = uiShadow.getElementById('toast');
    if (toast) setTimeout(() => { try { toast.remove(); } catch {} }, 4500);
    const fab = uiShadow.getElementById('fab');
    if (fab) setTimeout(() => fab.classList.remove('flash'), 3000);
    return uiShadow;
  }

  function $(sel) { return uiShadow.querySelector(sel); }

  function wirePanel() {
    $('#fab').addEventListener('click', () => {
      const p = $('#panel'); p.hidden = !p.hidden;
      if (!p.hidden) { refreshPanelStatus(); hydrateExportSampleCheckbox(); }
    });
    const exportSampleEl = $('#opt-export-sample');
    if (exportSampleEl) {
      exportSampleEl.addEventListener('change', () => {
        try { GM_setValue(GM_KEY_EXPORT_SAMPLE, !!exportSampleEl.checked); }
        catch (e) { warn('persist exportSampleEnabled failed', e); }
      });
    }
    $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });
    $('#act-full').addEventListener('click', () => runFullFetch());
    $('#act-incremental').addEventListener('click', () => runIncrementalFetch());
    $('#act-export').addEventListener('click', () => exportJsonForWebapp('manual'));
    $('#act-clear').addEventListener('click', async () => {
      if (!confirm('Wipe all stored Board Games data? This cannot be undone.')) return;
      await dbDestroy(); await refreshPanelStatus();
      alert('All data cleared.');
    });
    $('#run-abort').addEventListener('click', abortRun);
    onRun(updateRunBar);
    refreshPanelStatus();
  }

  /**
   * Wire hover-tooltips for every `.info-tip` (`?`) element in the panel.
   *
   * Why this is JS-driven rather than a pure-CSS `:hover::after` trick:
   * #panel has `overflow: auto` (so long status content can scroll), and a
   * `position: absolute` tooltip nested inside #panel gets clipped at the
   * panel's edge — which is exactly what was happening in v0.7.1 (see the
   * "Quick run" / "Export JSON now" tips having their left half cut off).
   *
   * Fix: render a SINGLE shared tooltip element as a sibling of #panel
   * (i.e. outside the overflow-clipping ancestor), then on hover, position
   * it with `position: fixed` based on the trigger's bounding rect. The
   * tooltip is right-aligned to the trigger and floats above it; if there
   * is not enough space above, we flip it below; if it would overflow
   * either viewport edge horizontally, we clamp.
   */
  function setupInfoTips() {
    const tip = uiShadow.getElementById('floating-tip');
    if (!tip) return;
    const VIEWPORT_PAD = 8;        // min distance from any viewport edge
    const TRIGGER_GAP  = 8;        // gap between tooltip and trigger

    const place = (trigger) => {
      const text = trigger.getAttribute('data-tip') || '';
      if (!text) return;
      tip.textContent = text;

      // Render off-screen first so we can measure with the final text in
      // place, then move into position. This avoids a one-frame flash at
      // an old location when the tooltip is re-shown for a different
      // trigger.
      tip.style.left = '-9999px';
      tip.style.top  = '-9999px';
      tip.classList.add('visible');

      const triggerRect = trigger.getBoundingClientRect();
      const tipRect     = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Default placement: above the trigger, right edge aligned with
      // trigger's right edge. (Most natural for buttons on the right
      // side of a panel.)
      let left = triggerRect.right - tipRect.width;
      let top  = triggerRect.top - tipRect.height - TRIGGER_GAP;

      // Flip below if there's no room above.
      if (top < VIEWPORT_PAD) {
        top = triggerRect.bottom + TRIGGER_GAP;
      }
      // Clamp horizontally so the tooltip never sticks off either edge.
      if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
      if (left + tipRect.width > vw - VIEWPORT_PAD) {
        left = vw - VIEWPORT_PAD - tipRect.width;
      }
      // Clamp vertically as a last resort (very tall tip on a short
      // viewport): keep at least the top edge on-screen.
      if (top + tipRect.height > vh - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - tipRect.height);
      }

      tip.style.left = `${Math.round(left)}px`;
      tip.style.top  = `${Math.round(top)}px`;
    };

    const hide = () => { tip.classList.remove('visible'); };

    uiShadow.querySelectorAll('.info-tip').forEach((el) => {
      el.addEventListener('mouseenter', () => place(el));
      el.addEventListener('mouseleave', hide);
      // Keyboard accessibility: focus shows, blur hides.
      el.setAttribute('tabindex', '0');
      el.addEventListener('focus', () => place(el));
      el.addEventListener('blur',  hide);
    });
  }

  // v0.7.14: read the persisted "Also export listings-example.json" toggle
  // and reflect it in the checkbox each time the panel is opened. Source of
  // truth is GM_getValue(GM_KEY_EXPORT_SAMPLE); default false.
  function hydrateExportSampleCheckbox() {
    if (!uiShadow) return;
    const cb = uiShadow.getElementById('opt-export-sample');
    if (!cb) return;
    let stored = false;
    try { stored = !!GM_getValue(GM_KEY_EXPORT_SAMPLE, false); } catch (e) { /* default false */ }
    cb.checked = stored;
  }

  // Read-only accessor used by 13-export.js to decide whether to emit
  // listings-example.json. Hits GM storage directly so it works whether or
  // not the panel has been opened this session.
  function isExportSampleEnabled() {
    try { return !!GM_getValue(GM_KEY_EXPORT_SAMPLE, false); }
    catch (e) { return false; }
  }

  async function refreshPanelStatus() {
    if (!uiShadow) return;
    try {
      const count = await dbCount(STORE_LISTINGS);
      const el = uiShadow.getElementById('kv-listings');
      if (el) el.textContent = count.toLocaleString();
      const lastFetch = await dbGet(STORE_META, 'lastFetchAt');
      const lf = uiShadow.getElementById('kv-last-fetch');
      if (lf) lf.textContent = lastFetch?.value ? new Date(lastFetch.value).toLocaleString() : 'never';
      const lastExportFromIdb = await dbGet(STORE_META, 'lastExportAt');
      let lastExportVal = lastExportFromIdb?.value;
      if (!lastExportVal) {
        try { lastExportVal = localStorage.getItem('bgbf.lastExportAt'); } catch (e) { /* ignore */ }
      }
      const le = uiShadow.getElementById('kv-last-export');
      if (le) le.textContent = lastExportVal ? new Date(lastExportVal).toLocaleString() : 'never';
    } catch (e) { warn('refreshPanelStatus failed', e); }
  }

  function updateRunBar(state) {
    if (!uiShadow) return;
    const bar = uiShadow.getElementById('run-bar');
    if (!bar) return;
    bar.hidden = !state.active && state.progress.phase !== 'complete';
    const msgEl = uiShadow.getElementById('run-msg');
    if (msgEl) msgEl.textContent = state.progress.message || '';
    let pct = 0;
    if (state.progress.totalSubcats) {
      pct = ((state.progress.doneSubcats / state.progress.totalSubcats) * 100) | 0;
      pct = clamp(pct, 0, 100);
    }
    if (state.progress.phase === 'complete') pct = 100;
    const pr = uiShadow.getElementById('run-progress');
    if (pr) pr.value = pct;
    refreshPanelStatus();
  }

  // ============================================================================
  // 17. MENU COMMANDS & DIAGNOSTICS
  // ============================================================================

  function registerMenuCommands() {
    dbg('menu', 'registerMenuCommands: wiring Tampermonkey menu entries');
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('🎲 Open Board Games panel',  () => { ensureUI(); $('#panel').hidden = false; refreshPanelStatus(); });
    GM_registerMenuCommand('⏩  Quick run (incremental fetch + export)', () => runIncrementalFetch());
    GM_registerMenuCommand('▶️  Run full fetch (slow)',     () => runFullFetch());
    GM_registerMenuCommand('💾  Export full corpus now',    () => exportJsonForWebapp('manual-menu'));
    GM_registerMenuCommand('📥  Import JSON backup',       importJson);
    GM_registerMenuCommand('⚙️   Settings (edit JSON)',      editSettingsPrompt);
    GM_registerMenuCommand('🔍  Diagnose extraction (current page)', diagnoseExtraction);
    GM_registerMenuCommand('🌐  Diagnose fetch (test one URL)',     diagnoseFetch);
    GM_registerMenuCommand('🧹  Re-purge existing data (apply current title blacklist)', async () => {
      if (!confirm(`Apply the current v${VERSION} title blacklist to all listings already in the database? Listings whose title matches the blacklist will be permanently deleted from local storage.`)) return;
      log('Manual re-purge requested by user');
      await postProcessAll();
      await refreshPanelStatus();
      alert('Re-purge complete. See the console for the count.');
    });
    GM_registerMenuCommand('🗑️   Clear ALL data',           async () => {
      if (confirm('Wipe all stored Board Games data? This cannot be undone.')) {
        await dbDestroy(); alert('Cleared.');
      }
    });
  }

  function editSettingsPrompt() {
    const current = settings.get();
    const text = prompt('Edit settings as JSON (be careful):', JSON.stringify(current, null, 2));
    if (!text) return;
    try {
      const next = JSON.parse(text);
      settings.save(next);
      alert('Settings saved.');
    } catch (e) {
      alert('JSON parse failed: ' + e.message);
    }
  }

  async function diagnoseExtraction() {
    log('=== DIAGNOSTIC ===');
    log('URL:', location.href);
    const html = document.documentElement.outerHTML;
    const { listings, totalCount, source } = extractListingsFromPage(html);
    log(`Source: ${source}`);
    log(`Listings extracted: ${listings.length}`);
    log(`totalCount: ${totalCount}`);
    if (listings.length) {
      const first = listings[0];
      log('First raw listing keys:', Object.keys(first));
      log('First raw listing (full):', first);
      const sample = listings.slice(0, 5).map((r) => {
        const n = normaliseListing(r);
        return n && {
          listingId: n.listingId, title: n.title, condition: n.condition,
          priceDisplay: n.priceDisplay, priceNumeric: n.priceNumeric, priceLabel: n.priceLabel,
          region: n.region,                                        // v0.7.10: endDate dropped (always null)
          isExpansion: n.isExpansion,                              // v0.7.11: was isAccessory
        };
      });
      console.table(sample);
    }
    alert(`Diagnostic complete. ${listings.length} listings via ${source}. See console for details.`);
  }

  async function diagnoseFetch() {
    const cat = CATEGORIES[0];
    const url = categoryUrl(cat.path, 1, { condition: 'new' });
    log('=== FETCH DIAGNOSTIC ===');
    log('Target URL:', url);
    const t0 = Date.now();
    try {
      const html = await fetchHtml(url, { maxAttempts: 1 });
      const elapsed = Date.now() - t0;
      log(`Fetch OK in ${elapsed}ms; ${html.length} bytes received.`);
      const { listings, totalCount, source } = extractListingsFromPage(html);
      log(`Extraction: ${listings.length} listings via ${source}, totalCount=${totalCount}`);
      alert(`Fetch test OK in ${elapsed}ms.\n${listings.length} listings extracted via ${source}.\nSee console for details.`);
    } catch (e) {
      const elapsed = Date.now() - t0;
      err(`Fetch test FAILED after ${elapsed}ms:`, e && (e.message || e));
      alert(`Fetch test FAILED after ${elapsed}ms.\nError: ${e && (e.message || e)}\nSee console for details.\n\n• "fetch-timeout" → connection hung; try clearing cookies on trademe.co.nz or waiting an hour.\n• "challenge-page-detected" → Cloudflare challenge; same fix.\n• HTTP 4xx/5xx → server-side error.`);
    }
  }

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

})();
