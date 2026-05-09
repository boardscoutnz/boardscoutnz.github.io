'use strict';

// ==========================================================================
// 02-config.js — Constants, config & matching knobs (APP_VERSION, URLs, NOISE/SENTINEL tokens, BGG column buckets)
// ==========================================================================

// 2. Configuration
// ============================================================================

const APP_VERSION = '1.6.18';
const BGG_RANKINGS_URL = './data/bgg-rankings.json';
const LISTINGS_URL  = './data/listings.json';

// Listings whose matched BGG entry is ranked higher than this number
// (i.e. less popular) — and listings that couldn't be matched at all —
// are flagged with a red ">5,000" pill in the BGG rank column. The user
// can additionally hide them via the sidebar's "Hide unranked games"
// checkbox.
const RANK_THRESHOLD = 10000;

// ---- Matching performance knobs (v1.6.9) -------------------------------
//
// The BGG enrichment pass calls matchTitle() once per listing — typically
// thousands of calls in a row. Without yielding control back to the
// browser, this locks the main thread for tens of seconds and makes the
// page look frozen. The constants below keep the page responsive and let
// us cap the worst-case latency of the Fuse fuzzy fallback.

// Number of listings processed in a single synchronous batch before
// yielding to the event loop. Lower = more responsive UI but slightly
// slower total throughput. 250 ≈ ~50–150ms per batch on a typical machine.
const MATCH_BATCH_SIZE = 250;

// Fuse.js fuzzy search is O(corpus × query) per call. With ~25k BGG
// entries × ~7k listings × thousands of Fuse-fallback calls, the fuzzy
// tier dominates the runtime. We cap the Fuse-searchable corpus to the
// top-N ranked games, on the basis that listings for games ranked > N
// are vanishingly rare in practice. Tier 1 (full-string exact) and Tier 2
// (token containment) still see the FULL BGG corpus, so this is a fuzzy-
// matching limit only, not a global limit. Set to 0 to disable Fuse
// entirely (Tier 3 won't run). Set to a very high number (e.g. 999999)
// to put every game into Fuse's index.
 
// v1.6.10: Fuse fallback is OFF. Fuse fuzzy-matches against the ORIGINAL
// (un-normalised) BGG primary names, which means it happily matches a
// listing of "Board games" to "Slay the Spire: The Board Game" because
// the substring "board game" appears inside the BGG name. That's
// exactly the false-positive class we don't want — we want the rule
// "every word of the BGG name must appear in the listing", which is
// what Tier 2 (token containment) already enforces strictly. Fuse also
// accounted for ~99% of enrichment runtime (~14 of the 16 minutes).
// Setting this to 0 disables Tier 3 entirely; matching is now Tier 1
// (full-string exact) + Tier 2 (token containment) only. Set to a
// positive number (e.g. 5000) to re-enable Fuse against the top-N
// ranked games if you ever decide to trade some accuracy for typo
// tolerance.
const FUSE_TOP_N_LIMIT = 0;

// If a single matchTitle() call takes longer than this many milliseconds,
// emit a diagnostic log line with the offending listing title. Useful for
// catching pathological titles that explode the Tier 2 candidate pool or
// run very slow Fuse searches. 25ms is well above normal (~0.5–2ms).
const MATCH_SLOW_LISTING_MS = 25;

// ---- Matching identity-canonicalisation (v1.6.12) ----------------------
//
// Some phrases inside game titles are NOISE in the sense that they
// don't help identify the game ("brand new", "auckland") — those go
// in NOISE_TOKENS below and get stripped out completely.
//
// Other phrases ARE part of the identity but appear in slightly
// different surface forms across listings ("2nd Edition" vs "Second
// Edition" vs "(Second Edition)"; "Card Game" vs "cardgame"). For
// those we use SENTINEL replacements: collapse every variant to a
// single canonical token (e.g. "ed2", "cardgame") so two BGG entries
// that differ only on the suffix don't collapse to the same key.
//
// Without sentinels: BGG "Power Grid" and "Power Grid: The Card
// Game" both normalise to "power grid" — Tier 1 picks one
// arbitrarily, Tier 2 can't tell them apart, the wrong one wins
// half the time. With sentinels: "Power Grid" → "power grid";
// "Power Grid: The Card Game" → "power grid cardgame". Distinct
// keys → correct matches.
//
// Order matters: longer alternations first so e.g. "second edition"
// is consumed before any other rule can touch "edition".
const SENTINEL_REPLACEMENTS = [
  // Edition markers — both word and ordinal forms, with optional
  // "ed." abbreviation. The captured group includes "ed" so
  // "(2nd ed.)" canonicalises the same as "Second Edition".
  { rx: /\b(?:1st|first)\s+(?:edition|ed)\b/gi,  repl: ' ed1 ' },
  { rx: /\b(?:2nd|second)\s+(?:edition|ed)\b/gi, repl: ' ed2 ' },
  { rx: /\b(?:3rd|third)\s+(?:edition|ed)\b/gi,  repl: ' ed3 ' },
  { rx: /\b(?:4th|fourth)\s+(?:edition|ed)\b/gi, repl: ' ed4 ' },
  { rx: /\b(?:5th|fifth)\s+(?:edition|ed)\b/gi,  repl: ' ed5 ' },
  // Game-type markers — these ARE part of identity (cf. "Power Grid"
  // vs "Power Grid: The Card Game") so we keep them, just normalise
  // the spacing.
  { rx: /\bcard\s+game\b/gi,     repl: ' cardgame ' },
  { rx: /\bcardgame\b/gi,        repl: ' cardgame ' },
  { rx: /\bboard\s+game\b/gi,    repl: ' boardgame ' },
  { rx: /\bboardgame\b/gi,       repl: ' boardgame ' },
  { rx: /\btabletop\s+game\b/gi, repl: ' tabletopgame ' },
  { rx: /\bdice\s+game\b/gi,     repl: ' dicegame ' },
  { rx: /\bparty\s+game\b/gi,    repl: ' partygame ' },
  { rx: /\bword\s+game\b/gi,     repl: ' wordgame ' },
  { rx: /\bfamily\s+game\b/gi,   repl: ' familygame ' },
  { rx: /\bstrategy\s+game\b/gi, repl: ' strategygame ' },
];

// Minimum character length for a single-token BGG primary name to
// be eligible for Tier 2 matching. With the threshold at 6 we
// index "cartographers" (catches issue 9) and "pandemic" but not
// "uno", "risk" or "catan" — those very-short names would create
// far too many false positives if matched anywhere other than at
// the listing's start (which the Tier 1 exact path already handles).
const MIN_SINGLE_TOKEN_LEN = 6;

// Trade Me board-game sub-category slugs → human-readable labels.
//
// Note: there are TWO separate "other" buckets that the userscript walks,
// distinguished by slug:
//   • `other`               — the board-games/other subcategory (the
//                             original "Board games — Other")
//   • `games-puzzles-other` — the parent-category "Other" bucket (a
//                             sibling of card-games and board-games at
//                             the games-puzzles-tricks level), added
//                             in userscript v0.7.0 / web app v1.5.2.
// The longer slug exists because the simpler `other` was already taken.
const SUBCAT_LABELS = {
  'card-games':           'Card Games',
  'childrens-games':      "Children's Games",
  'dice-games':           'Dice Games',
  'party-games':          'Party Games',
  'strategy-war-games':   'Strategy & War Games',
  'word-games':           'Word Games',
  'other':                'Board Games — Other',
  'games-puzzles-other':  'Games & Puzzles — Other',
};
function subcatLabel(slug) {
  if (!slug) return '';
  if (SUBCAT_LABELS[slug]) return SUBCAT_LABELS[slug];
  return slug.split('-').map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

const NOISE_TOKENS = [
  // v1.6.10: common English stop-words. These tokens add nothing to a
  // game name's identity, but they DO bloat the tokenToEntryIdx
  // (the existing top-10 buckets were `the=2780, of=1877, in=396,
  // a=368, to=232, for=215`) and they create huge candidate pools in
  // Tier 2 for any listing containing them. Stripping them from BOTH
  // listing and BGG names symmetrically means matching is unaffected
  // — "Lord of the Rings" normalises to "lord rings" on both sides
  // and still matches itself. Roman numerals (ii, iii, iv) are
  // INTENTIONALLY excluded; many real games use them ("Civilization
  // II", "Twilight Imperium IV").
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'by',
  'from', 'is', 'as', 'its', 'it', 'this', 'that', 'all',
  // (existing entries below are unchanged) ----------------------------
  'brand new', 'as new', 'like new', 'good condition', 'excellent condition',
  'mint condition', 'in shrink', 'still sealed', 'never played', 'never opened',
  'unopened', 'unused', 'still wrapped', 'in wrapper', 'shrink wrapped',
  'shrink wrap', 'free shipping', 'free postage', 'free freight',
  'reduced price', 'best offer', 'no reserve', 'pickup only',
  'auckland', 'wellington', 'christchurch', 'hamilton', 'tauranga', 'dunedin',
  'shipped from', 'ships from', 'nz wide',
  'tabletop', 'expansion pack', 'expansion set', 'limited edition',
  'collector edition', 'collectors edition', 'deluxe edition',
  'special edition', 'anniversary edition', 'kickstarter edition',
  'kickstarter exclusive', 'retail edition', 'premium edition',
  'english edition', 'english version', 'nz edition', 'us edition',
  'sealed', 'mint', 'bnib', 'bnip', 'oop', 'shrink', 'rare', 'kickstarter',
  'ks', 'retail', 'deluxe', 'premium', 'collectors', 'collector',
  'anniversary', 'limited', 'exclusive', 'edition', 'version', 'english',
  'complete', 'with', 'and', 'or', 'plus', 'inc', 'incl', 'including',
  'includes', 'extras', 'expansions',
];

const PUNCT_RX  = /[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~\u2010-\u2015\u2018-\u201F\u2022\u2026]/g;
const QTY_RX    = /\b\d{2,4}\s*(?:piece|pieces|pcs|pc|cards?)\b/gi;
const YEAR_RX   = /\b(19|20)\d{2}\b/g;
const MULTISP   = /\s+/g;

// BGG match-confidence thresholds.
const FUSE_THRESHOLD = 0.3;
const UNCERTAIN_GAP  = 0.05;

// Show numbered priority badges only when the user is sorting by 2+ columns.
// A single-column sort is unambiguous — the arrow alone communicates it —
// so a "1" badge would just be visual noise.
const MIN_SORTERS_FOR_BADGES = 2;

// BGG-derived columns are split into two buckets:
//
//   • BGG_BASIC_COLUMNS — the columns that are populated from the
//     csv-only BGG ranks build (rank + average rating). These are
//     toggled by the "BGG Mode" topbar button. BGG Mode is ON by
//     default (they show on first paint); flipping the toggle hides
//     them. The grid columns themselves are constructed with
//     `visible: true` for these fields in buildColumns().
//
//   • BGG_FULL_COLUMNS — the columns whose source data only arrives
//     from the XML API (weight, player counts, playing time, alt
//     names). They stay hidden until the full BGG cache pipeline is
//     live (pending API key). They are NOT toggled by BGG Mode.
//
// The sidebar's BGG filter section (#sidebar-bgg-section) is also
// intentionally left hidden regardless of BGG Mode — those filters
// operate on fields that are still null in csv-only builds.

// v1.6.11: bgg_name moved into the BASIC bucket. It powers the
// "BGG Entry" column — the matched BGG game name with hyperlink and
// match-confidence icon — which is the single most useful column for
// auditing match accuracy at a glance. Toggling BGG Mode now hides
// and shows three columns together: BGG Entry, BGG Rank, BGG Rating.
const BGG_BASIC_COLUMNS = ['bgg_name', 'bgg_rank', 'bgg_average'];
const BGG_FULL_COLUMNS  = ['bgg_weight', 'bgg_min_players', 'bgg_playing_time'];

