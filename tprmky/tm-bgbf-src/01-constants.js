  // ============================================================================
  // 1. CONSTANTS
  // ============================================================================

  const VERSION = '0.7.17';
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

  // ─────────────────────────────────────────────────────────────────────────
  // Crawl-speed presets (v0.7.15)
  // ─────────────────────────────────────────────────────────────────────────
  // CRAWL_SPEED_PRESETS is the single source of truth for every
  // humanization tunable that affects per-request timing. The active key is
  // exposed via getActivePresetKey() / getActivePresetConfig() and is
  // selected by the user via the dashboard slider in 14-ui.js. The runtime
  // pacing in 04-utilities.js (politeSleep) and 07-network.js (fetchHtml
  // retry backoff) reads from the active preset at use-time so a mid-crawl
  // switch affects subsequent requests without restarting the run.
  //
  // Tunable fields (all numeric except label / themeColor):
  //   delayMultiplier          — scales the polite-sleep mean. settings.politeDelayMs * delayMultiplier = mean.
  //   delayJitterRange         — width coefficient on the triangular kernel; larger = wider spread.
  //                              The formula `delta = mean * (triKernel * R + (1 - R/2))` keeps E[delta] = mean
  //                              for any R, since E[triKernel] = 0.5.
  //   delayLoMult / delayHiMult — post-clamp bounds expressed as multiples of mean. Triangular sums concentrate
  //                              tightly around the mean so clamp tails barely shift E[delta].
  //   humanPauseFrequency      — 1-in-N polite-sleep cadence at which a long pause MAY fire.
  //   humanPauseProbability    — probability the cadence-tick actually fires (so the pause itself isn't periodic).
  //   humanPauseMultMin/Max    — pause length is mean * uniform(min, max).
  //   humanPauseCompensationRequests — N sleeps over which to refund the extra time. Only active for FASTEST
  //                              and BALANCED — SAFEST deliberately under-refunds (see comment) so net average
  //                              actually grows in the safest mode.
  //   retryJitterMin / retryJitterMax — multiplicative jitter applied to the exponential backoff base on retry.
  //
  // Justifications for the chosen multipliers:
  //   FASTEST  — must match v0.7.14 behaviour exactly so upgraders see no change. delayMultiplier=1.0, kernel
  //              coefficient 2.4 with [-0.2, +1.6]X clamp window: identical numbers to the previous top-level
  //              constants. Default for first-run users. Themed red since this is the highest-detection-risk mode.
  //   BALANCED — ~1.75x mean, ~25% wider jitter, human pauses ~2x more frequent (1-in-18 within the user-suggested
  //              15-25 band), pauses themselves ~30% longer; backoff jitter spread roughly doubled. Picks a
  //              middle-ground operating point for a typical session.
  //   SAFEST   — ~3.5x mean (in the 3-4x band), kernel approaching uniform-random across a wide window, human
  //              pauses 1-in-10 (within the 8-12 band) and substantially longer; longest backoff windows on retry.
  //              Use after a TM rate-limit warning or when crawling outside normal hours.
  //
  // Color theming: red for FASTEST (#c0392b — pre-existing in the codebase), orange for BALANCED (#e67e22 —
  // same saturation family), green for SAFEST (#09b17d — matches the v1.6.19/1.6.20 Show-ALL-Listings green).
  // These three hex literals MUST live ONLY in this object — every consumer reads them via the
  // --preset-color CSS custom property set by the slider rendering code.

  const PRESET_FASTEST  = 'fastest';
  const PRESET_BALANCED = 'balanced';
  const PRESET_SAFEST   = 'safest';

  const CRAWL_SPEED_PRESETS = {
    [PRESET_FASTEST]: {
      label: 'Fastest',
      themeColor: '#c0392b',
      delayMultiplier: 1.0,
      delayJitterRange: 2.4,
      delayLoMult: 0.4,
      delayHiMult: 1.6,
      humanPauseFrequency: 32,
      humanPauseProbability: 0.5,
      humanPauseMultMin: 3,
      humanPauseMultMax: 6,
      humanPauseCompensationRequests: 3,
      retryJitterMin: 0.7,
      retryJitterMax: 1.4,
    },
    [PRESET_BALANCED]: {
      label: 'Balanced',
      themeColor: '#e67e22',
      delayMultiplier: 1.75,
      delayJitterRange: 3.0,
      delayLoMult: 0.35,
      delayHiMult: 1.85,
      humanPauseFrequency: 18,
      humanPauseProbability: 0.6,
      humanPauseMultMin: 4,
      humanPauseMultMax: 8,
      humanPauseCompensationRequests: 4,
      retryJitterMin: 0.5,
      retryJitterMax: 2.0,
    },
    [PRESET_SAFEST]: {
      label: 'Safest',
      themeColor: '#09b17d',
      delayMultiplier: 3.5,
      delayJitterRange: 4.0,
      delayLoMult: 0.25,
      delayHiMult: 2.0,
      humanPauseFrequency: 10,
      humanPauseProbability: 0.8,
      humanPauseMultMin: 5,
      humanPauseMultMax: 10,
      humanPauseCompensationRequests: 5,
      retryJitterMin: 0.4,
      retryJitterMax: 3.0,
    },
  };

  // Module-scope cache of the active preset key. Hydrated from GM-storage on
  // first read; updated by the slider's input handler in 14-ui.js. Reading
  // from GM-storage on every fetch would be unnecessarily synchronous I/O.
  // Note: each browser tab has its own module scope, so a preset change in
  // one tab does NOT propagate to other tabs without a reload — acceptable
  // for a single-user tool. Mid-crawl preset switches affect ONLY requests
  // issued AFTER the switch; an already-in-flight `await sleep(…)` is not
  // shortened or extended retroactively.
  let _activePresetKey = null;
  function getActivePresetKey() {
    if (_activePresetKey == null) {
      try {
        const stored = GM_getValue(GM_KEY_CRAWL_SPEED_PRESET, PRESET_FASTEST);
        _activePresetKey = (stored in CRAWL_SPEED_PRESETS) ? stored : PRESET_FASTEST;
      } catch (e) {
        _activePresetKey = PRESET_FASTEST;
      }
    }
    return _activePresetKey;
  }
  function setActivePresetKey(key) {
    if (!(key in CRAWL_SPEED_PRESETS)) return;
    _activePresetKey = key;
    try { GM_setValue(GM_KEY_CRAWL_SPEED_PRESET, key); } catch (e) { /* non-fatal */ }
  }
  function getActivePresetConfig() {
    return CRAWL_SPEED_PRESETS[getActivePresetKey()];
  }

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
  'Rain Jacket', 'Purple Donkey', 'Babies', 'Baby', 'Valentine', 'Logic', 'Heroclix', 'Approved', 'Fairy', 'Quiddler', 'Trex', 'Bang!', 'Hitster', 'Boggle', 'Dragons', 'Beasts', 'Beast', 'Mooncake', 'Tantrix', 'Werewolf', 'England', 'Dixit', 'Monster', 'Briarpatch', 'beer pong', 'rubik', 'rubiks', 'Any', 'buy now per game', 'Casino', 'punch', 'punching', 'Poker', 'Craps', 'Chair', 'noughts and crosses', 'Doll house', 'dollhouse', 'Deck Case', 'Billiards', 'jenga', 'Snooker', 'Subbuteo', 'Air Hockey', 'chess', 'jigsaw', 'mahjong', 'outdoor', 'vintage', 'backgammon', 'scrabble', 'cornhole', 'warhammer', 'wargaming', 'd&d', 'dnd', 'dungeons and dragons', 'dungeons & dragons', 'heroquest', 'pathfinder', 'cthulhu', 'q workshop', 'mtg', 'magic the gathering', 'yu-gi-oh', 'yugioh', 'keyforge', 'battletech', 'heroscape', 'unlock!', 'exit the game', 'escape room', 'exploding kittens', 'top trumps', 'tarot deck', 'tarot', 'polyhedral', 'dice set', 'dice set dice games', 'card binder', 'card shuffler', 'monopoly', 'cribbage', 'yahtzee', 'rummy', 'bingo', 'lottery', 'roulette', 'domino', 'connect 4', 'connect four', 'battleship', 'tic tac toe', 'tic-tac-toe', 'maze', 'spot it', 'memory', 'puzzle', 'puzzles', 'sticker book', 'trivia', 'uno', 'waddingtons', 'bicycle', 'humanity', 'children', 'kids', 'toddler', 'educational', 'alphabet', 'orchard', 'thinkfun', 'bigjigs', 'kosmos', 'haba', 'lego', 'plastic', 'magnetic', 'sensory', 'novelty', 'unicorns', 'corn hole', 'foosball', 'football', 'puck game', 'ring toss', 'bag toss', 'whack mole', 'throw throw', 'prize wheel', 'raffle', 'game table cloth', 'date night', 'drinking game', 'drinking games', 'drink', 'drunk', 'game set', 'high quality', 'professional', 'performance', 'interactive', 'interaction', 'sex', 'intimate', 'intimacy', 'labia', 'dick', 'f**k', 'f***', 'f***?', 'hitler', 'lube', 'penis', 'meme', 'playing cards', 'afx', 'ak interactive', 'ptn', 'mancala', 'checkers', 'Pokémon', 'Pokémon', 'Pokemon', 'Pokemon', 'Mahjongg', 'Mah jong', 'Mah Jongg', 'Strapless', 'Remote', 'Video Game', 'Toy', 'Pub game', 'Number Balls', 'Blowjob', 'Bulk Family', 'Bulk games', 'Bulk boardgames', 'Bulk board games', 'Bulk lot', 'Sudoku', 'Cards Against', 'Citadels', 'Cluedo', 'Cooked Aussies', 'D & D', 'Disney', 'Gambling', 'Wooden Toss', 'Building Block', 'Building Blocks', 'Fidget', '30ML', 'Bottle Opener', 'Bubblegum', 'Buzzed', 'Buzzer', 'Darts', 'Dartboard', 'Board Toy', 'Ass', 'Dumb', 'Whack A Mole', 'Curling', 'Shuffleboard', 'Bible', 'Guess Who', 'Guess Who?', 'Kitty', 'Handbag', 'Hungry Hippos', 'Jumanji', 'Projector', 'Mouse Trap', 'Pictionary', '1000 Piece', '1000 Pieces', '1000-Piece', '1000-Pieces', '1000Piece', '1000Pieces', 'Pressure Washer', 'Psycho Killer', 'Psycho Killer:', 'Healing Crystal', 'Ridley\'s', 'Ridleys', 'Ridley', 'RISK', 'Santa', 'Christmas', 'WASJIG', 'Shut The Box', 'Smart Games', 'SmartGames', 'Flash Card', 'Flash Cards', 'Chameleon', 'Walking Dead', 'Washers', 'Trail by Trolley', 'Twister', 'Vampire', 'Velcro', 'Unmatched', 'Thomas', 'Runequest', 'Brimstone', 'Pokémon', 'Harry Potter', 'Gloomhaven', 'Final Girl', 'Zombicide', 'Lord of the Rings', 'Axis & Allies', 'One Piece', 'Paw Patrol', 'Adult', 'Arkham Horror', 'Basketball', 'Beat That', 'Blue Opal', 'Bluey', 'Bop It', 'Blood on the Clocktower', 'xHaba', 'Dragon Shield', 'Card Holder', 'Card Holders', 'Card Sleeve', 'Card Sleeves', 'Dice Cup', 'Dice Cups', 'Dice Tray', 'Dice Trays', 'Tablecloth', 'Carry Case', 'Carry Cases', 'Game Dice', 'Citadel', 'Folded Space', 'Storage Container', 'Gamegenic', 'Kingshield', 'LPG', 'MDG', 'Monument Pro', 'Ultra Pro', 'Ultimate Guard', 'Cushion', 'Pillow', 'Tangram', 'Paddle Ball', 'Four in a Row', 'Quoits', 'Cricket', 'Brain Teaser', 'Pub Quiz', 'Balancing Game', 'Noughts & Crosses', 'Murder Mystery', 'Game Prop', 'Game Props', 'Melissa & Doug', 'Matching Game', 'Twerk', 'Colouring Book', 'Coloring Book', 'Oracle Deck', 'Fortune Telling', 'Iron Clays', 'Tumbling Tower', 'Dice Pack', 'Reversible', 'Snakes and Ladders', 'Snakes & Ladders', 'Shooters and Ladders', 'Shooters & Ladders', 'Shooters + Ladders', 'Chutes and Ladders', 'Chutes & Ladders', 'Chutes + Ladders', 'Cup Holders', 'Mathematics', 'Hot Wheels', 'Ten Pin Bowling', 'Newtons Cradle', 'Hedbanz', 'Conversation Cards', 'Conversation Starter', 'Conversation Starters', 'Couples Conversation', 'Dating Game', 'Dating Games', 'Dating Card', 'Dating Cards', 'Blank Dice', 'Wooden Dice', '500pcs', 'Per Pack', 'Premium Sleeves', '1pc', '2pc', '3pc', '4pc', '5pc', '6pc', '7pc', '8pc', '9pc', '10pc', '1pcs', '2pcs', '3pcs', '4pcs', '5pcs', '6pcs', '7pcs', '8pcs', '9pcs', '10pcs', '15pc', '15pcs', '20pc', '20pcs', '25pc', '25pcs', '50pc', '50pcs', '100pc', '100pcs', '200pc', '200pcs', '250pc', '250pcs', '500pc', '100 Pcs', '12Pcs', '40pcs', '50 Pack', '6 Nimmt!', 'Akumulate', 'Ping Pong', 'Photo Cards', 'Colorful Balls', 'Bachelorette', 'Microns', 'Waterproof', 'Stress Relief', 'Wooden Set', 'Magic Trick', 'Magical Trick', 'Road Trip', 'Crafts', 'Wooden Disc', 'Wooden Disk', 'Clue Board Game', 'Clue BoardGame', 'Pleasure', 'Crazy Caterpillar', 'Police Alert', 'Dodgeball', 'Rainbow Ball', 'House Props', 'Taboo', 'AFL', 'NRL', '30 Seconds', '5 Second Rule', 'LED', 'Fun Family Game', 'Playing Card', 'Playing Cards', '8 ball', '8 balls', 'gas burner', 'RPG', 'warcraft', 'atomsfear', 'real estate', 'Scattergories', 'Binding of Isaac', 'stratego', 'cockroach', 'realestate', 'Witcher', 'Funko', 'Fisher Price', 'Jenga', 'Latex', 'BCW', 'crochet', 'Spanish game', 'Spanish word', 'Eugy', 'Party Game', 'Sticky Ball', 'Bouncy Ball', 'Bouncy Balls', 'iPhone', 'Five Crown', 'Spinner Game', 'Heads & Tails', 'Dragonball Z', 'Getting Lost', '150pcs', 'Multiplication Game', 'Multiplication Board Game', 'Xmas', 'Christmas', 'Bible', 'Puck', 'Chutes and ladders', 'Pictureka', 'Pictureka!', 'DMS', 'Bridgestone', 'Bum', 'Poo', 'Funny Joke', 'OC', 'Pogo', 'Unicorn', 'Spelling Game', 'Spelling Games', 'Rummikub', 'Draughts', 'Power Rangers', 'Final Fantasy', 'Dragon Ball', 'dog Man', 'Bad People', 'Tsuro', 'Retro', 'Dad Joke', 'Dad Jokes', 'FIFA', 'Party Card', 'Party Cards', 'Magic', 'Magical', 'N64', 'Jitterbugs', 'Pickle', 'Soccer', 'Golf', 'Frisbee', 'Rugby', 'Mindware', '18+', 'Game of Life', 'Bayblades', 'Bayblade', 'Beyblades', 'Beyblade', 'Volleyball', 'Mage', 'Telestrations', 'D6', 'Munchkin', 'Binding of Isaac', 'My Little Pony', 'Deck Box', 'Cranium', 'Balderdash', 'Catch Phrase', 'Family Feud', 'Apples to Apples', '50 Shades', 'Yakkity', 'AD&D', 'Angry Birds', 'Atmosfear', 'Cashflow', 'Dragon', 'Electronic', 'Hungry Hippo', 'Spinning Top', 'Spinning Tops', 'Kaleidoscope', 'Mindtrap', 'Mind Trap', 'Multi', 'Crossword', 'T-Rex', 'Pass the', 'Fart', 'Farts', 'Scene It', 'Sesame Street', 'Nasty', 'Tiddlywinks', 'Tiddly Winks', 'Upwords', 'Zombie', 'Wordigo', 'Collectibles', 'Formula 1', 'Hellboy', 'Five Nights', 'Stainless', 'Lilo', 'Ghost', 'Podcast', 'Monument Hobbies', 'Mana', 'Soundtrack', 'Soundtracks', 'Qwirkle', 'Horrible', 'Articulate', 'Pictomania', 'Couples Game', 'NSFW', '15-in-1', 'Rhymes', 'Duck Duck', 'Photo Booth', 'Industrial', 'Audio Game', 'Gobblet', 'Gobblers', 'Wooden Block', 'Wooden Blocks', 'Brain Train', 'Nerf', 'Grammar', 'Trax', 'Nought', 'Noughts', 'Zeus', 'LOTR', 'Crokinole', 'Tainted Grail', '48PC', 'Stainless Steel', 'GraviTrax', 'Corpses', 'Corpse', 'Mickey Mouse', 'Adjustable', 'McDonalds', 'Corrupted', 'Academia', 'Fck', 'Marble Run', 'Bong', 'Elmo', 'Drawing', 'Games Night', 'Bottoms', 'Nutz', 'Screwdriver', 'Pop!', 'Vinyl', 'Stoner', 'Unsolved', 'Laugh', 'Mah-jong', 'Vocabulary', 'Burrito', 'Soluble', 'Squid', 'SingBall', 'Elvis', 'Worst', 'Imploding', 'Exploding', 'Lava', 'Tumble Tower', 'Pig', 'Pigs', 'Addition', 'Subtraction', 'Polaroid', 'Barbie', 'IQ', 'Goosebumps', 'Strawberry', 'Cocktail', 'Selfish', 'Emotional', 'Sims', 'Gangsta', 'Granny', 'Freak', 'Chronicle Card', 'Burger', 'Furry', 'Cuffs', 'Grounded', 'Pictoo', 'Rick', 'Morty', 'Gruffalo', 'Penguin', 'Flirt', 'Flirty', 'Organze', 'Nimmt', 'Glow in the dark', 'Exercise', 'Exercises', 'Disturb', 'Disturbed', 'OMG', 'Stranger', 'Brainbox', 'Googly', 'Pancake', 'Pancakes', 'Stiff', 'She Said', 'Shot Game', 'Shots Game', 'Elastic Band', 'Elastic Bands', 'Squish', 'Squishy', 'Peeing', 'Pee', 'Weeing', 'Wee', 'Tyrannosaurus', 'Lovebird', 'Lovebirds', 'Shadowverse', 'Junior', 'Acquisition', 'Carrom', 'diddy', 'joking', 'Enchanted', 'Looping', 'Llama', 'Llamas', 'Crazy', 'Pop', 'Sorry', 'Butt', 'Chicken', 'Candy', 'Candyland', 'Mastermind', 'Kubb', 'Boom', 'Tuatara', 'f*ck?', 'PJ', 'Parents', 'Insanity', 'Wicked', 'Willie', 'Willy', 'Jumping', 'Maniacs', 'Wobbly', 'Worm', 'Worms', 'Emoji', 'Homemade', 'Home-made', 'Home made', 'Matariki', 'Awful', 'Joke', 'Trinity', 'Jesus', 'God', 'Liquor', 'Spinner', 'Spinners', 'Spin', 'Spinning', 'Maori', 'liar', 'caterpillar', 'NBA'
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
  // v0.7.15: persisted crawl-speed preset key (one of PRESET_FASTEST /
  // PRESET_BALANCED / PRESET_SAFEST). Default 'fastest' so upgraders from
  // v0.7.14 see identical timing.
  const GM_KEY_CRAWL_SPEED_PRESET = 'crawlSpeedPreset';

  // v0.7.17: persisted rolling history of completed runs. Each entry
  // captures duration, start/end timestamps, run type (full vs
  // incremental), the crawl-speed preset that was active at run start,
  // listings count, and outcome. Used by the dashboard's "Recent runs"
  // panel to build up a per-preset timing dataset over many sessions.
  const GM_KEY_RUN_HISTORY = 'runHistory.v1';
  const RUN_HISTORY_MAX = 50;

// ============================================================================
