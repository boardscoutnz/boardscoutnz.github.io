  // ============================================================================
  // 1. CONSTANTS
  // ============================================================================

  const VERSION = '0.7.12';
  const LOG_PREFIX = '[bgbf]';

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
    'Briarpatch', 'beer pong', 'rubik', 'rubiks', 'Any', 'buy now per game', 'Casino', 'punch', 'punching', 'Poker', 'Craps', 'Chair', 'noughts and crosses', 'Doll house', 'dollhouse', 'Deck Case', 'Billiards', 'jenga', 'Snooker', 'Subbuteo', 'Air Hockey', 'chess', 'jigsaw', 'mahjong', 'outdoor', 'vintage', 'backgammon', 'scrabble', 'cornhole', 'warhammer', 'wargaming', 'd&d', 'dnd', 'dungeons and dragons', 'dungeons & dragons', 'heroquest', 'pathfinder', 'cthulhu', 'q workshop', 'mtg', 'magic the gathering', 'yu-gi-oh', 'yugioh', 'keyforge', 'battletech', 'heroscape', 'unlock!', 'exit the game', 'escape room', 'exploding kittens', 'top trumps', 'tarot deck', 'tarot', 'polyhedral', 'dice set', 'dice set dice games', 'card binder', 'card shuffler', 'trading card', 'monopoly', 'cribbage', 'yahtzee', 'rummy', 'bingo', 'lottery', 'roulette', 'domino', 'connect 4', 'connect four', 'battleship', 'tic tac toe', 'tic-tac-toe', 'maze', 'spot it', 'memory', 'puzzle', 'puzzles', 'sticker book', 'trivia', 'uno', 'waddingtons', 'bicycle', 'humanity', 'children', 'kids', 'toddler', 'educational', 'alphabet', 'orchard', 'thinkfun', 'bigjigs', 'kosmos', 'haba', 'lego', 'plastic', 'magnetic', 'sensory', 'novelty', 'unicorns', 'corn hole', 'foosball', 'football', 'puck game', 'ring toss', 'bag toss', 'whack mole', 'throw throw', 'prize wheel', 'raffle', 'game table cloth', 'date night', 'drinking game', 'drinking games', 'drink', 'drunk', 'game set', 'high quality', 'professional', 'performance', 'interactive', 'interaction', 'sex', 'intimate', 'intimacy', 'labia', 'dick', 'f**k', 'f***', 'f***?', 'hitler', 'lube', 'penis', 'meme', 'playing cards', 'afx', 'ak interactive', 'ptn', 'mancala', 'checkers', 'Pokémon Card', 'Pokémon Cards', 'Pokemon Card', 'Pokemon Cards', 'Mahjongg', 'Mah jong', 'Mah Jongg', 'Strapless', 'Remote', 'Video Game', 'Toy', 'Pub game', 'Number Balls', 'Blowjob', 'Bulk Family', 'Bulk games', 'Bulk boardgames', 'Bulk board games', 'Bulk lot', 'Sudoku', 'Cards Against', 'Citadels', 'Cluedo', 'Cooked Aussies', 'D & D', 'Disney', 'Gambling', 'Wooden Toss', 'Building Block', 'Building Blocks', 'Fidget', '30ML', 'Bottle Opener', 'Bubblegum', 'Buzzed', 'Buzzer', 'Darts', 'Dartboard', 'Board Toy', 'Ass', 'Dumb', 'Whack A Mole', 'Curling', 'Shuffleboard', 'Bible', 'Guess Who', 'Guess Who?', 'Kitty', 'Handbag', 'Hungry Hippos', 'Jumanji', 'Projector', 'Mouse Trap', 'Pictionary', '1000 Piece', '1000 Pieces', '1000-Piece', '1000-Pieces', '1000Piece', '1000Pieces', 'Pressure Washer', 'Psycho Killer', 'Psycho Killer:', 'Healing Crystal', 'Ridley\'s', 'Ridleys', 'Ridley', 'RISK', 'Santa', 'Christmas', 'WASJIG', 'Shut The Box', 'Smart Games', 'SmartGames', 'Flash Card', 'Flash Cards', 'Chameleon', 'Walking Dead', 'Washers', 'Trail by Trolley', 'Twister', 'Vampire', 'Velcro', 'Unmatched', 'Thomas', 'Runequest', 'Brimstone', 'Pokémon', 'Harry Potter', 'Gloomhaven', 'Final Girl', 'TCG', 'LCG', 'Zombicide', 'Lord of the Rings', 'Axis & Allies', 'One Piece', 'Paw Patrol', 'Adult', 'Arkham Horror', 'Basketball', 'Beat That', 'Blue Opal', 'Bluey', 'Bop It', 'Blood on the Clocktower', 'xHaba', 'Dragon Shield', 'Card Holder', 'Card Holders', 'Card Sleeve', 'Card Sleeves', 'Dice Cup', 'Dice Cups', 'Dice Tray', 'Dice Trays', 'Tablecloth', 'Carry Case', 'Carry Cases', 'Game Dice', 'Citadel', 'Folded Space', 'Storage Container', 'Gamegenic', 'Kingshield', 'LPG', 'MDG', 'Monument Pro', 'Ultra Pro', 'Ultimate Guard', 'Cushion', 'Pillow', 'Tangram', 'Paddle Ball', 'Four in a Row', 'Quoits', 'Cricket', 'Brain Teaser', 'Pub Quiz', 'Balancing Game', 'Noughts & Crosses', 'Murder Mystery', 'Game Prop', 'Game Props', 'Melissa & Doug', 'Matching Game', 'Twerk', 'Colouring Book', 'Coloring Book', 'Oracle Deck', 'Fortune Telling', 'Iron Clays', 'Tumbling Tower', 'Dice Pack', 'Reversible', 'Snakes and Ladders', 'Snakes & Ladders', 'Cup Holders', 'Mathematics', 'Hot Wheels', 'Ten Pin Bowling', 'Newtons Cradle', 'Hedbanz', 'Conversation Cards', 'Dating Game', 'Dating Games', 'Dating Card', 'Dating Cards', 'Blank Dice', 'Wooden Dice', '500pcs', 'Per Pack', 'Premium Sleeves', '1pc', '2pc', '3pc', '4pc', '5pc', '6pc', '7pc', '8pc', '9pc', '10pc', '1pcs', '2pcs', '3pcs', '4pcs', '5pcs', '6pcs', '7pcs', '8pcs', '9pcs', '10pcs', '15pc', '15pcs', '20pc', '20pcs', '25pc', '25pcs', '50pc', '50pcs', '100pc', '100pcs', '200pc', '200pcs', '250pc', '250pcs', '500pc', '6 Nimmt!', 'Akumulate', 'Ping Pong', 'Photo Cards', 'Colorful Balls', 'Bachelorette', 'Microns', 'Waterproof', 'Stress Relief', 'Wooden Set', 'Magic Trick', 'Magical Trick', 'Road Trip', 'Crafts', 'Wooden Disc', 'Wooden Disk'
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

// ============================================================================
