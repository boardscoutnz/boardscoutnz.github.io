// tprmky/bsnz-pipeline-src/05-fuzzy-match.js
// ===== Three-tier matcher + match phase =====
// Inputs:  BSNZ.tm_listings (from 02-tm-scraper.js), BSNZ.bgg_corpus (from
//          03-bgg-corpus.js: byId, byNormName, nameEntries, tokenToEntryIdx,
//          normaliseTitle, getOverride, setOverride — all in closure scope).
// Outputs: BSNZ.title_to_bgg = Map<normTitle, {id, method, confidence}|null>,
//          BSNZ.unmatched_titles = [{raw, norm}, …],
//          BSNZ.stats.exact_matches / .fuzzy_matches counters.
// Side effects: calls window.bsnzShowUnmatched(unmatched) at end of phase
//               if the UI module has registered the hook.
//
// Port of js/06-matching.js's Tier 1/2 logic against the in-userscript
// BGG corpus indexes — same multi-set containment, position-and-order
// sort priority, single-token-at-pos-0 rule, 2-token-out-of-order reject.
// Tier 3 (Fuse.js) is enabled here as a fallback; the site-side matcher
// keeps it disabled because of historic false-positive cost.

  // Min length for single-token BGG names to qualify as Tier 2 candidates.
  // Mirrors js/02-config.js's MIN_SINGLE_TOKEN_LEN (6) — keeps "game"/"the"
  // out, keeps "pandemic"/"cartographers" in. Index-time enforcement lives
  // in buildIndexes (03-bgg-corpus.js); this is the runtime guard.
  const MIN_SINGLE_TOKEN_LEN = 6;

  // Lazily-built Fuse instance over BSNZ.bgg_corpus.nameEntries. Built on
  // first matchTitle() call and discarded when the corpus is replaced (we
  // key it by the corpus identity via a stored reference).
  let _fuse = null;
  let _fuseCorpusRef = null;
  function _getFuse() {
    const entries = BSNZ.bgg_corpus && BSNZ.bgg_corpus.nameEntries;
    if (!entries) return null;
    if (_fuse && _fuseCorpusRef === entries) return _fuse;
    if (typeof Fuse === 'undefined') return null;
    _fuse = new Fuse(entries, {
      keys: ['normName'],
      includeScore: true,
      threshold: FUZZY_MATCH_THRESHOLD,
      ignoreLocation: true,
      minMatchCharLength: 3
    });
    _fuseCorpusRef = entries;
    return _fuse;
  }

  // Walk listing tokens looking for the BGG tokens in sequence, allowing
  // arbitrary gaps. Returns {start, inOrder, contiguous}. Mirrors
  // findPositionInListing() in js/06-matching.js.
  function _findPositionInListing(bggTokens, listingTokens) {
    let pos = 0;
    let firstPos = -1;
    let lastPos = -1;
    for (const bt of bggTokens) {
      while (pos < listingTokens.length && listingTokens[pos] !== bt) pos++;
      if (pos >= listingTokens.length) {
        let earliest = Infinity;
        for (const t of bggTokens) {
          const idx = listingTokens.indexOf(t);
          if (idx >= 0 && idx < earliest) earliest = idx;
        }
        return {
          start: earliest === Infinity ? -1 : earliest,
          inOrder: false,
          contiguous: false
        };
      }
      if (firstPos === -1) firstPos = pos;
      lastPos = pos;
      pos++;
    }
    const contiguous = (lastPos - firstPos + 1) === bggTokens.length;
    return { start: firstPos, inOrder: true, contiguous };
  }

  // Three-tier match. rawTitle is unused at this layer (kept for parity
  // with the site-side signature and for future publisher-strip hooking);
  // normTitle has already been normalised by the caller.
  function matchTitle(rawTitle, normTitle) {
    if (!normTitle || normTitle.length < 3) return null;
    const corpus = BSNZ.bgg_corpus;
    if (!corpus) return null;

    // Tier 1 — full-string exact match.
    const exact = corpus.byNormName.get(normTitle);
    if (exact) {
      return { id: exact.id, method: 'exact_match', confidence: 1.0 };
    }

    // Tier 2 — token containment with position scoring.
    const listingTokens = normTitle.split(' ').filter((t) => t.length > 0);
    let candidatePoolSize = 0;
    if (listingTokens.length >= 1) {
      const listingTokenCounts = new Map();
      for (const t of listingTokens) {
        listingTokenCounts.set(t, (listingTokenCounts.get(t) || 0) + 1);
      }
      const candidateIdxs = new Set();
      for (const t of listingTokens) {
        const bucket = corpus.tokenToEntryIdx.get(t);
        if (bucket) for (const i of bucket) candidateIdxs.add(i);
      }
      candidatePoolSize = candidateIdxs.size;

      const matches = [];
      for (const i of candidateIdxs) {
        const entry = corpus.nameEntries[i];

        if (entry.tokens.length === 1) {
          const bggToken = entry.tokens[0];
          if (bggToken.length < MIN_SINGLE_TOKEN_LEN) continue;
          if (listingTokens[0] !== bggToken) continue;
          if (normTitle === bggToken) continue;
          matches.push({
            entry, position: 0, nameLen: 1,
            contiguous: true, inOrder: true, rank: entry.rank
          });
          continue;
        }

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

        const posInfo = _findPositionInListing(entry.tokens, listingTokens);
        matches.push({
          entry,
          position: posInfo.start === -1 ? Number.MAX_SAFE_INTEGER : posInfo.start,
          nameLen: entry.tokens.length,
          contiguous: posInfo.contiguous,
          inOrder: posInfo.inOrder,
          rank: entry.rank
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

        // Hard reject: 2-token, neither contiguous nor in-order
        // ("Wonders of the World" vs BGG "World Wonders").
        if (top.nameLen === 2 && !top.contiguous && !top.inOrder) {
          // fall through to Tier 3
        } else {
          let confidence;
          if (top.contiguous) confidence = 1.0;
          else if (top.nameLen === 1) confidence = 0.95;
          else if (top.inOrder && top.nameLen >= 4) confidence = 0.9;
          else if (top.inOrder) confidence = 0.75;
          else if (top.nameLen >= 3) confidence = 0.7;
          else confidence = 0.5;
          // Confidence semantics mirror js/06-matching.js's exact/fuzzy/
          // uncertain labels: contiguous OR (in-order ≥4) OR (single-token
          // at pos 0) → 'exact_match' (confidence 1.0/.95/.9); shorter
          // in-order or out-of-order ≥3 → 'fuzzy_match'; else uncertain
          // but still emitted as fuzzy_match for downstream simplicity.
          const method = (top.contiguous ||
                          top.nameLen === 1 ||
                          (top.inOrder && top.nameLen >= 4))
            ? 'exact_match'
            : 'fuzzy_match';
          return { id: top.entry.id, method, confidence };
        }
      }

      if (candidatePoolSize === 0) return null;
    }

    // Tier 3 — Fuse.js fuzzy fallback against nameEntries[].normName.
    const fuse = _getFuse();
    if (!fuse) return null;
    const hits = fuse.search(normTitle);
    if (!hits.length) return null;
    const top = hits[0];
    if (typeof top.score !== 'number' || top.score >= FUZZY_MATCH_THRESHOLD) return null;
    return {
      id: top.item.id,
      method: 'fuzzy_match',
      confidence: 1 - top.score
    };
  }

  // Phase entry point. Iterates unique normalised titles, applies manual
  // overrides first, then matchTitle(). Buckets results into title_to_bgg
  // (resolved) or unmatched_titles (no candidate) and surfaces the latter
  // to the UI for manual resolution.
  async function runMatchPhase(signal) {
    log('info', 'Match phase starting');
    runHistoryStartPhase('match');
    BSNZ.title_to_bgg = new Map();
    BSNZ.unmatched_titles = [];
    const uniqueTitles = [...new Set(BSNZ.tm_listings.map((l) => l.tm_title))];
    for (let i = 0; i < uniqueTitles.length; i++) {
      if (signal.aborted) throw new Error('aborted');
      const raw = uniqueTitles[i];
      const norm = normaliseTitle(raw);

      const override = getOverride(norm);
      if (override !== undefined) {
        if (override === null || override.id === null) {
          BSNZ.title_to_bgg.set(norm, null);
        } else {
          BSNZ.title_to_bgg.set(norm, { id: override.id, method: 'manual_override', confidence: 1.0 });
        }
        continue;
      }

      const result = matchTitle(raw, norm);
      if (result) {
        BSNZ.title_to_bgg.set(norm, result);
        if (result.method === 'exact_match') {
          BSNZ.stats.exact_matches = (BSNZ.stats.exact_matches || 0) + 1;
        } else {
          BSNZ.stats.fuzzy_matches = (BSNZ.stats.fuzzy_matches || 0) + 1;
        }
      } else {
        BSNZ.unmatched_titles.push({ raw, norm });
      }
      if (typeof window.bsnzUpdateProgress === 'function') {
        window.bsnzUpdateProgress('match', { done: i + 1, total: uniqueTitles.length });
      }
    }
    log('info', `Match: ${BSNZ.title_to_bgg.size} matched, ${BSNZ.unmatched_titles.length} unmatched`);
    runHistoryEndPhase('match', {
      matched: BSNZ.title_to_bgg.size,
      unmatched: BSNZ.unmatched_titles.length
    });
    if (BSNZ.unmatched_titles.length > 0 && typeof window.bsnzShowUnmatched === 'function') {
      window.bsnzShowUnmatched(BSNZ.unmatched_titles);
    }
  }
