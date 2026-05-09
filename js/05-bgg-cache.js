'use strict';

// ==========================================================================
// 05-bgg-cache.js — Fetch + parse bgg-rankings.json, build the matching index (byNormName, nameEntries, tokenToEntryIdx, optional Fuse)
// ==========================================================================

// ============================================================================
// 5. BGG cache loader
// ============================================================================

async function loadBggCache() {
  dbg('bgg', `loadBggCache: fetching ${BGG_RANKINGS_URL}`);
  dbgTime('bgg cache total');
  setBggStatus('loading…');
  try {
    const res = await fetch(BGG_RANKINGS_URL);
    dbg('bgg', `BGG cache fetch returned: status=${res.status}, ok=${res.ok}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const games = await res.json();
    if (!Array.isArray(games)) throw new Error('cache is not an array');
    dbg('bgg', `BGG cache parsed: ${games.length.toLocaleString()} games`);

    bgg.games = games;
    bgg.byId = new Map(games.map((g) => [g.id, g]));

    dbgTime('bgg index build');
    bgg.byNormName = new Map();
    let altNameCount = 0;
    for (const g of games) {
      const primary = normalizeTitle(g.primaryName || '');
      if (primary && !bgg.byNormName.has(primary)) {
        bgg.byNormName.set(primary, g);
      }
      for (const alt of g.alternateNames || []) {
        altNameCount++;
        const n = normalizeTitle(alt);
        if (n && !bgg.byNormName.has(n)) {
          bgg.byNormName.set(n, g);
        }
      }
    }
    dbg('bgg', `byId index: ${bgg.byId.size.toLocaleString()} entries`);
    dbg('bgg', `byNormName index: ${bgg.byNormName.size.toLocaleString()} entries (from ${games.length.toLocaleString()} primary + ${altNameCount.toLocaleString()} alt names)`);

    // Build nameEntries (one record per searchable name — primary
    // plus every alt) and the inverted token index used by the
    // token-containment matcher in matchTitle().
    dbgTime('bgg nameEntries+tokenIdx build');
    bgg.nameEntries = [];
    for (const g of games) {
      const names = [g.primaryName, ...(g.alternateNames || [])];
      for (const nm of names) {
        if (!nm) continue;
        const norm = normalizeTitle(nm);
        if (!norm) continue;
        const tokens = norm.split(' ').filter((t) => t.length > 0);
        if (!tokens.length) continue;
        bgg.nameEntries.push({
          id: g.id,
          normName: norm,
          tokens,
          rank: (typeof g.rank === 'number' && g.rank > 0) ? g.rank : Number.POSITIVE_INFINITY,
        });
      }
    }
    // Sort by descending token count so longer (more specific) names
    // are checked first — gives "Brass: Birmingham" priority over
    // "Brass" when both could in theory match a listing.
    bgg.nameEntries.sort((a, b) => b.tokens.length - a.tokens.length);

    bgg.tokenToEntryIdx = new Map();
    let singleTokenIndexed = 0;
    for (let i = 0; i < bgg.nameEntries.length; i++) {
      const entry = bgg.nameEntries[i];
      // v1.6.12: single-token names are now indexed IF the token is
      // long enough to be specific. The Tier 2 matcher additionally
      // requires the listing to start with the token, which keeps
      // these matches conservative — see the single-token branch in
      // matchTitle. Listings whose entire normalised form IS the
      // single token are still caught by Tier 1 (bgg.byNormName)
      // before Tier 2 runs.
      if (entry.tokens.length < 2) {
        if (entry.tokens[0].length < MIN_SINGLE_TOKEN_LEN) continue;
        singleTokenIndexed++;
      }
      for (const t of entry.tokens) {
        let bucket = bgg.tokenToEntryIdx.get(t);
        if (!bucket) { bucket = new Set(); bgg.tokenToEntryIdx.set(t, bucket); }
        bucket.add(i);
      }
    }
    dbgTimeEnd('bgg nameEntries+tokenIdx build');
    dbg('bgg', `nameEntries: ${bgg.nameEntries.length.toLocaleString()} (primary + alt names, ≥1 token each)`);
    dbg('bgg', `tokenToEntryIdx: ${bgg.tokenToEntryIdx.size.toLocaleString()} unique tokens indexed (${singleTokenIndexed.toLocaleString()} single-token entries with len ≥ ${MIN_SINGLE_TOKEN_LEN})`);

    // Fuse corpus is intentionally restricted — see FUSE_TOP_N_LIMIT.
    // Tier 1 (full-string exact) and Tier 2 (token containment) operate
    // on the full BGG corpus; only Tier 3 (fuzzy fallback) is capped.
    const fuseList = [];
    let fuseSkippedNoRank = 0;
    let fuseSkippedRankTooLow = 0;
    for (const g of games) {
      const rank = (typeof g.rank === 'number' && g.rank > 0) ? g.rank : null;
      if (rank == null) { fuseSkippedNoRank++; continue; }
      if (FUSE_TOP_N_LIMIT > 0 && rank > FUSE_TOP_N_LIMIT) { fuseSkippedRankTooLow++; continue; }
      fuseList.push({ id: g.id, name: g.primaryName, game: g });
      for (const alt of g.alternateNames || []) {
        if (alt && alt !== g.primaryName) {
          fuseList.push({ id: g.id, name: alt, game: g });
        }
      }
    }
    if (FUSE_TOP_N_LIMIT > 0 && fuseList.length > 0) {
      bgg.fuse = new Fuse(fuseList, {
        keys: ['name'],
        threshold: FUSE_THRESHOLD,
        ignoreFieldNorm: true,
        ignoreLocation: true,
        includeScore: true,
        minMatchCharLength: 3,
      });
      dbg('bgg', `Fuse fuzzy index built: ${fuseList.length.toLocaleString()} searchable name strings (top ${FUSE_TOP_N_LIMIT.toLocaleString()} by rank; skipped ${fuseSkippedRankTooLow.toLocaleString()} below rank cap, ${fuseSkippedNoRank.toLocaleString()} unranked)`);
    } else {
      bgg.fuse = null;
      dbgWarn('bgg', `Fuse fuzzy index DISABLED (FUSE_TOP_N_LIMIT=${FUSE_TOP_N_LIMIT}). Tier 3 fallback will not run; only Tier 1 (exact) and Tier 2 (token containment) will be used.`);
    }

    // Diagnostic — surface the 10 BGG-name tokens with the largest
    // candidate buckets in the inverted index. Outsized buckets
    // (e.g. ≥1000 entries for one token) are the typical culprit when
    // Tier 2 takes longer than expected on listings that contain that
    // token. A common-stop-word like "the" or "of" showing up here is
    // a hint to add it to NOISE_TOKENS.
    const bucketSizes = [];
    bgg.tokenToEntryIdx.forEach((set, tok) => bucketSizes.push([tok, set.size]));
    bucketSizes.sort((a, b) => b[1] - a[1]);
    dbg('bgg', `tokenToEntryIdx: top 10 largest buckets: ${
      bucketSizes.slice(0, 10).map(([t, n]) => `${t}=${n}`).join(', ')
    }`);

    dbgTimeEnd('bgg index build');

    bgg.loaded = true;
    bgg.error = null;
    setBggStatus(`${games.length.toLocaleString()} games`);
    dbgTimeEnd('bgg cache total');

    if (listings.length > 0) {
      dbg('bgg', `${listings.length.toLocaleString()} listings already loaded — re-running BGG enrichment now that cache is ready`);
      await enrichListingsWithBgg(listings);   // v1.6.9: now async/chunked
      if (table) {
      dbg('bgg', 'table exists — calling replaceData to push enriched rows back into the grid');
      table.replaceData(listings);
      table.redraw(true);   // v1.6.13: prevent virtual-DOM scroll desync (see applyFilters)
      dbg('bgg', 'replaceData + redraw(true) complete');
      logGridRenderState('post-bgg-replaceData');
    } else {
      dbg('bgg', 'table not yet built — enrichment will be visible when grid renders');
    }
      updateStatsBar();
    } else {
      dbg('bgg', 'no listings ingested yet — enrichment will run inside ingestJson when listings arrive');
    }


  } catch (e) {
    dbgTimeEnd('bgg cache total');
    dbgWarn('bgg', 'BGG cache load failed:', e.message);
    console.warn('BGG cache load failed:', e);
    bgg.loaded = false;
    bgg.error = e.message;
    setBggStatus('not loaded');
  }
}

function setBggStatus(text) {
  dbg('bgg', `BGG status pill → "${text}"`);
  const pill = document.getElementById('bgg-status-pill');
  if (pill) pill.textContent = text;
}

