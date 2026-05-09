'use strict';

// ==========================================================================
// 06-matching.js — normalizeTitle, matchTitle (Tier 1/2/3), enrichListingsWithBgg async batch enrichment
// ==========================================================================

// ============================================================================
// 6. Title normalization & matching
// ============================================================================

function normalizeTitle(s) {
  if (!s) return '';
  let n = String(s).toLowerCase();
  n = n.replace(PUNCT_RX, ' ');
  n = n.replace(QTY_RX, ' ');
  n = n.replace(YEAR_RX, ' ');
  // v1.6.12: sentinel canonicalisation must run BEFORE NOISE_TOKENS
  // strips "edition" / "game" generically — otherwise the sentinels
  // would have nothing left to match. Order within the array matters
  // (see SENTINEL_REPLACEMENTS comment in §2).
  for (const { rx, repl } of SENTINEL_REPLACEMENTS) {
    n = n.replace(rx, repl);
  }
  const sorted = [...NOISE_TOKENS].sort((a, b) => b.length - a.length);
  for (const tok of sorted) {
    const rx = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    n = n.replace(rx, ' ');
  }
  n = n.replace(MULTISP, ' ').trim();
  return n;
}

// v1.6.12: helper for the new in-order / position-aware Tier 2 logic.
// Walks the listing tokens left-to-right looking for the BGG tokens in
// sequence, allowing arbitrary gaps between them. Returns the position
// and ordering metadata that the matcher uses to rank candidates and
// assign confidence. The cost is O(L + B) per call; cheap enough to
// run for every Tier 2 candidate.
//
// Examples:
//   findPositionInListing(["crew","mission","deep","sea"],
//                         ["crew","2","mission","deep","sea"])
//     → { start: 0, inOrder: true, contiguous: false }
//
//   findPositionInListing(["world","wonders"],
//                         ["wonders","world"])
//     → { start: 1, inOrder: false, contiguous: false }
//     (the BGG tokens exist in the listing but in reverse order)
//
//   findPositionInListing(["rising","sun"],
//                         ["dominion","rising","sun"])
//     → { start: 1, inOrder: true, contiguous: true }
function findPositionInListing(bggTokens, listingTokens) {
  let pos = 0;
  let firstPos = -1;
  let lastPos = -1;
  for (const bt of bggTokens) {
    while (pos < listingTokens.length && listingTokens[pos] !== bt) pos++;
    if (pos >= listingTokens.length) {
      // Greedy in-order walk failed. Fall back to the leftmost
      // listing position of any BGG token (so out-of-order matches
      // still get a sensible `start` for sorting purposes).
      let earliest = Infinity;
      for (const t of bggTokens) {
        const idx = listingTokens.indexOf(t);
        if (idx >= 0 && idx < earliest) earliest = idx;
      }
      return {
        start: earliest === Infinity ? -1 : earliest,
        inOrder: false,
        contiguous: false,
      };
    }
    if (firstPos === -1) firstPos = pos;
    lastPos = pos;
    // v1.6.20: pos++ here advances PAST the matched index, so two
    // consecutive identical BGG tokens (e.g. ["hop","hop"]) correctly
    // consume two distinct listing positions rather than re-matching
    // the same one. This is equivalent to `pos = idx + 1` and is safe
    // under the new multi-set containment semantics.
    pos++;
  }
  const contiguous = (lastPos - firstPos + 1) === bggTokens.length;
  return { start: firstPos, inOrder: true, contiguous };
}

/**
 * Match a TradeMe listing title to the most likely BGG game.
 *
 * Three-tier strategy, run in order; the first tier to find a hit
 * wins:
 *
 *   1. Full-string exact match. The whole normalised listing title
 *      is looked up in bgg.byNormName. Cheapest, highest confidence.
 *      Catches well-formed titles like "Brass: Birmingham".
 *
 *   2. Token-containment match. Tokenise the listing, then for every
 *      BGG name whose tokens are a SUBSET of the listing's tokens,
 *      treat it as a candidate. Among candidates we prefer
 *        (a) the longest BGG name in tokens (most specific — "Brass:
 *            Birmingham" beats "Brass" alone),
 *        (b) a contiguous substring match over a scattered one
 *            ("brass birmingham" appearing as a phrase beats
 *            ["brass", "extras", "birmingham"]),
 *        (c) better BGG rank (ties go to more popular games).
 *      Single-token BGG names are excluded from this step — they'd
 *      false-positive on common listing words like "Game" or
 *      "Cards". The exact-match step above already catches a
 *      listing whose entire normalised form IS a single-token BGG
 *      name (e.g. "Catan").
 *      The inverted bgg.tokenToEntryIdx narrows ~25k entries down
 *      to a small candidate pool before the containment check
 *      itself runs.
 *
 *   3. Fuse.js fuzzy fallback. Catches typos and minor mis-spellings
 *      that tier 2's exact-token equality misses.
 *
 * IMPORTANT: not logged on every call — runs ~7k times during
 * enrichment. Aggregate stats are emitted from enrichListingsWithBgg.
 * To trace one listing manually, run from the console:
 *     matchTitle("My Game Title")
 */
function matchTitle(title) {
  // v1.6.9: per-call timing for slow-listing detection. Cheap enough
  // (a couple of microseconds per call) to leave on permanently.
  const t0 = (isDebugEnabled() && performance && performance.now) ? performance.now() : 0;

  if (!bgg.loaded) {
    return { bggId: null, confidence: 'none', score: null, candidates: [] };
  }
  const n = normalizeTitle(title);
  if (!n || n.length < 3) {
    return { bggId: null, confidence: 'none', score: null, candidates: [] };
  }

  // ---- Tier 1: full-string exact match ---------------------------
  const exact = bgg.byNormName.get(n);
  if (exact) {
    maybeLogSlowMatch(t0, title, 'tier1-exact');
    return { bggId: exact.id, confidence: 'exact', score: 0, candidates: [exact] };
  }

  // ---- Tier 2: token containment ---------------------------------
  // v1.6.12: now position-aware and order-aware. A BGG entry is a
  // candidate iff every one of its tokens appears in the listing.
  // Among candidates we prefer (in this order):
  //   1. earliest listing position (the game name is almost always
  //      at the START of a TradeMe title)
  //   2. longest BGG name (more specific wins for the same start
  //      position, e.g. "Catan: Cities & Knights" over "Catan")
  //   3. contiguous over scattered
  //   4. in-order over out-of-order
  //   5. better BGG rank
  //
  // Single-token BGG names are eligible if (a) their token is
  // length ≥ MIN_SINGLE_TOKEN_LEN AND (b) the listing's FIRST
  // token equals it. This catches issue 9 ("Cartographers - A
  // Roll Player Tale" → "Cartographers") without re-introducing
  // the false-positive class for short common-word names.
  const listingTokens = n.split(' ').filter((t) => t.length > 0);
  let candidatePoolSize = 0;
  if (listingTokens.length >= 1) {
    // v1.6.20: multi-set (bag) containment. Previously we used a Set,
    // which let "Hop! Hop! Hop!" match "Pop n Hop" because every BGG
    // "hop" found the listing's single "hop". Now each BGG token
    // INSTANCE must be matched by a distinct listing-token instance.
    const listingTokenSet = new Set(listingTokens);
    const listingTokenCounts = new Map();
    for (const t of listingTokens) {
      listingTokenCounts.set(t, (listingTokenCounts.get(t) || 0) + 1);
    }

    const candidateIdxs = new Set();
    for (const t of listingTokens) {
      const bucket = bgg.tokenToEntryIdx.get(t);
      if (bucket) {
        for (const i of bucket) candidateIdxs.add(i);
      }
    }
    candidatePoolSize = candidateIdxs.size;

    const matches = [];
    for (const i of candidateIdxs) {
      const entry = bgg.nameEntries[i];

      // Single-token branch: must be at position 0 of the listing
      // AND meet the length threshold (already enforced at index-
      // build time, but defensive). Also skip if the listing IS
      // exactly this token, since Tier 1 has already handled that.
      if (entry.tokens.length === 1) {
        const bggToken = entry.tokens[0];
        if (bggToken.length < MIN_SINGLE_TOKEN_LEN) continue;
        if (listingTokens[0] !== bggToken) continue;
        if (n === bggToken) continue;
        matches.push({
          entry,
          position: 0,
          nameLen: 1,
          contiguous: true,
          inOrder: true,
          rank: entry.rank,
        });
        continue;
      }

      // Multi-token branch: every BGG token INSTANCE must be matched
      // by a distinct listing-token instance (multi-set containment).
      // v1.6.20: a per-entry usedSoFar Map tracks how many copies of
      // each token we've already consumed; we fail as soon as demand
      // exceeds supply. (Set semantics let "Hop! Hop! Hop!" match
      // "Pop n Hop"; bag semantics correctly reject it.)
      if (entry.tokens.length > listingTokens.length) continue;
      let allPresent = true;
      const usedSoFar = new Map();
      for (const t of entry.tokens) {
        const available = listingTokenCounts.get(t) || 0;
        const used = usedSoFar.get(t) || 0;
        if (used + 1 > available) { allPresent = false; break; }
        usedSoFar.set(t, used + 1);
      }
      if (!allPresent) continue;

      const posInfo = findPositionInListing(entry.tokens, listingTokens);
      matches.push({
        entry,
        position: posInfo.start === -1 ? Number.MAX_SAFE_INTEGER : posInfo.start,
        nameLen: entry.tokens.length,
        contiguous: posInfo.contiguous,
        inOrder: posInfo.inOrder,
        rank: entry.rank,
      });
    }

    if (matches.length > 0) {
      matches.sort((a, b) =>
        a.position - b.position ||
        b.nameLen - a.nameLen ||
        (Number(b.contiguous) - Number(a.contiguous)) ||
        (Number(b.inOrder) - Number(a.inOrder)) ||
        a.rank - b.rank
      );
      const top = matches[0];

      // v1.6.12: hard rejection rule — 2-token matches that are
      // neither contiguous nor in-order are too weak to keep
      // (issue 12: "Wonders of the World" matching "World
      // Wonders"). For longer BGG names the in-order signal
      // already distinguishes good from bad, so the rule only
      // applies at nameLen 2.
      if (top.nameLen === 2 && !top.contiguous && !top.inOrder) {
        maybeLogSlowMatch(t0, title, `tier2-rejected (2-token out-of-order): ${top.entry.normName}`);
        return { bggId: null, confidence: 'none', score: null, candidates: [] };
      }

      const game = bgg.byId.get(top.entry.id);
      if (game) {
        // Confidence semantics:
        //   contiguous                           → 'exact'   (strongest)
        //   in-order, ≥4 tokens                  → 'exact'   (issues 4, 11)
        //   in-order, 2–3 tokens                 → 'fuzzy'
        //   single-token at position 0           → 'exact'   (issue 9)
        //   out-of-order, ≥3 tokens              → 'fuzzy'
        //   anything else (already filtered above by reject rule)
        //                                        → 'uncertain'
        let confidence;
        let score;
        if (top.contiguous) {
          confidence = 'exact'; score = 0.05;
        } else if (top.nameLen === 1) {
          confidence = 'exact'; score = 0.08;
        } else if (top.inOrder && top.nameLen >= 4) {
          confidence = 'exact'; score = 0.1;
        } else if (top.inOrder) {
          confidence = 'fuzzy'; score = 0.2;
        } else if (top.nameLen >= 3) {
          confidence = 'fuzzy'; score = 0.25;
        } else {
          confidence = 'uncertain'; score = 0.35;
        }
        const candidateGames = matches
          .slice(0, 5)
          .map((m) => bgg.byId.get(m.entry.id))
          .filter(Boolean);
        maybeLogSlowMatch(t0, title, `tier2-${confidence} (pool=${candidatePoolSize}, hits=${matches.length}, name="${top.entry.normName}", pos=${top.position}, contig=${top.contiguous}, inOrder=${top.inOrder})`);
        return { bggId: game.id, confidence, score, candidates: candidateGames };
      }
    }

    // No Tier 2 match. Same Fuse-skip safety as before.
    if (candidatePoolSize === 0) {
      maybeLogSlowMatch(t0, title, 'no-token-overlap → skipping Fuse');
      return { bggId: null, confidence: 'none', score: null, candidates: [] };
    }
  }

  // ---- Tier 3: Fuse.js fuzzy fallback ----------------------------
  // v1.6.9: bgg.fuse may be null if FUSE_TOP_N_LIMIT === 0.
  if (!bgg.fuse) {
    maybeLogSlowMatch(t0, title, 'no-fuse');
    return { bggId: null, confidence: 'none', score: null, candidates: [] };
  }
  const hits = bgg.fuse.search(n).slice(0, 5);
  if (!hits.length) {
    maybeLogSlowMatch(t0, title, 'tier3-empty');
    return { bggId: null, confidence: 'none', score: null, candidates: [] };
  }
  const [hitTop] = hits;
  if (hits.length === 1 || (hits[1].score - hitTop.score) > UNCERTAIN_GAP) {
    maybeLogSlowMatch(t0, title, 'tier3-fuzzy');
    return {
      bggId: hitTop.item.game.id,
      confidence: 'fuzzy',
      score: hitTop.score,
      candidates: hits.map((h) => h.item.game),
    };
  }
  maybeLogSlowMatch(t0, title, 'tier3-uncertain');
  return {
    bggId: hitTop.item.game.id,
    confidence: 'uncertain',
    score: hitTop.score,
    candidates: hits.map((h) => h.item.game),
  };
}

// v1.6.9: helper used by matchTitle() to flag pathologically slow
// matches. Fires only above MATCH_SLOW_LISTING_MS so the console
// doesn't drown in normal-speed calls.
function maybeLogSlowMatch(t0, title, tier) {
  if (!t0 || !isDebugEnabled() || !isCatEnabled('match')) return;
  const elapsed = performance.now() - t0;
  if (elapsed >= MATCH_SLOW_LISTING_MS) {
    dbgWarn('match', `slow match (${elapsed.toFixed(1)}ms, ${tier}): "${title}"`);
  }
}

/**
 * Enrich listings with BGG metadata in async batches.
 *
 * v1.6.9: was a synchronous tight loop that called matchTitle() once
 * per listing in one go. With ~7k listings × ~25k BGG entries × Fuse
 * fallback per un-matched listing, the loop blocked the main thread
 * for tens of seconds — making the page look frozen / crashed.
 *
 * The new version processes listings in batches of MATCH_BATCH_SIZE
 * and awaits a 0ms timeout between batches. This yields the event
 * loop back to the browser, so layouts paint, the status pill
 * updates, and clicks remain responsive even when total enrichment
 * takes 20–30+ seconds on a slow run. There is no functional
 * difference in the output — every listing still gets matched.
 *
 * Diagnostic output covers (at debug level):
 *   • per-batch timing                — to spot slow chunks
 *   • per-tier hit counts             — to confirm the matcher is
 *                                       behaving (mostly Tier 1+2
 *                                       hits, modest Tier 3 fallthrough)
 *   • slow-listing warnings           — emitted from matchTitle()
 *   • final aggregate match-rate stats
 *
 * Returns a Promise — callers MUST `await` it (see ingestJson and
 * loadBggCache).
 */
async function enrichListingsWithBgg(arr) {
  dbgGroup('match', `enrichListingsWithBgg: ${arr.length.toLocaleString()} listings, cache ${bgg.loaded ? 'LOADED' : 'NOT loaded'}, batch=${MATCH_BATCH_SIZE}`);
  dbgTime('enrichListingsWithBgg');
  setBggStatus(`matching 0/${arr.length.toLocaleString()}…`);

  const stats = { exact: 0, fuzzy: 0, uncertain: 0, none: 0 };
  const total = arr.length;
  let processed = 0;
  let batchCount = 0;

  while (processed < total) {
    const batchStart = processed;
    const batchEnd = Math.min(processed + MATCH_BATCH_SIZE, total);
    const batchT0 = performance.now();

    for (let i = batchStart; i < batchEnd; i++) {
      const l = arr[i];
      const m = matchTitle(l.title);
      stats[m.confidence] = (stats[m.confidence] || 0) + 1;
      l.bgg_match_confidence = m.confidence;
      l.bgg_match_score = m.score;
      if (m.bggId) {
        const g = bgg.byId.get(m.bggId);
        if (g) {
          l.bgg_id = g.id;
          l.bgg_name = g.primaryName;
          l.bgg_year = g.year ?? null;
          l.bgg_rank = (typeof g.rank === 'number' && g.rank > 0) ? g.rank : null;
          l.bgg_average = g.average ?? null;
          l.bgg_weight = (typeof g.weight === 'number' && g.weight > 0) ? g.weight : null;
          l.bgg_min_players = g.minPlayers ?? null;
          l.bgg_max_players = g.maxPlayers ?? null;
          l.bgg_playing_time = g.playingTime ?? null;
        }
      } else {
        l.bgg_id = null;
        l.bgg_name = null;
        l.bgg_year = null;
        l.bgg_rank = null;
        l.bgg_average = null;
        l.bgg_weight = null;
        l.bgg_min_players = null;
        l.bgg_max_players = null;
        l.bgg_playing_time = null;
      }
    }

    processed = batchEnd;
    batchCount++;
    const batchMs = performance.now() - batchT0;
    dbg('match', `batch ${batchCount}: listings ${batchStart}–${batchEnd - 1} processed in ${batchMs.toFixed(0)}ms (running stats: exact=${stats.exact}, fuzzy=${stats.fuzzy}, uncertain=${stats.uncertain}, none=${stats.none})`);
    setBggStatus(`matching ${processed.toLocaleString()}/${total.toLocaleString()}…`);

    // Yield to the event loop so the browser can repaint, run the
    // status-pill update, handle any pending clicks, etc. A 0ms
    // setTimeout is the canonical "give the browser a turn" idiom.
    // requestAnimationFrame would also work but ties us to the
    // refresh rate.
    if (processed < total) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const matched = stats.exact + stats.fuzzy + stats.uncertain;
  dbg('match', `match results — exact: ${stats.exact.toLocaleString()}, fuzzy: ${stats.fuzzy.toLocaleString()}, uncertain: ${stats.uncertain.toLocaleString()}, none: ${stats.none.toLocaleString()}`);
  dbg('match', `match rate: ${matched.toLocaleString()}/${total.toLocaleString()} (${total ? (100 * matched / total).toFixed(1) : '0.0'}%) over ${batchCount} batches`);
  setBggStatus(bgg.loaded ? `${bgg.games.length.toLocaleString()} games (${matched.toLocaleString()} matched)` : 'not loaded');
  dbgTimeEnd('enrichListingsWithBgg');
  dbgGroupEnd('match');
}

