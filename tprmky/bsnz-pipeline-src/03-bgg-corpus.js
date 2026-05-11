// tprmky/bsnz-pipeline-src/03-bgg-corpus.js
// ===== BGG corpus refresh module =====
// Inputs:  BGG_RANKS_PAGE_URL (00-config.js), BSNZ.config.bgg_corpus_*.
// Outputs: BSNZ.bgg_corpus = { games, byId, byNormName, nameEntries,
//                              tokenToEntryIdx, fetched_at }.
//          BSNZ.stats.bgg_corpus_size.
// Side effects: GM_setValue('bgg_corpus', ...) caches the shaped game list.
//               GM_setValue('override:<normName>', ...) for manual overrides.
//
// Runs inside the shared IIFE opened in 00-config.js. fflate comes from a
// `@require` directive there. The matcher in a later step will mirror the
// indexes built here against js/05-bgg-cache.js's structure exactly.
//
// Port of the standalone tprmky/bgg-ranks-exporter.user.js: zip URL scrape,
// fflate-unzip, BOM-strip, RFC-4180 tokenise, shape. The exporter writes a
// JSON file; this module instead caches the shaped list in GM storage and
// builds the in-memory matching indexes.

  // --- GM_setValue cache helpers --------------------------------------------
  const BGG_CORPUS_CACHE_KEY = 'bgg_corpus';

  function getCachedCorpus() {
    return GM_getValue(BGG_CORPUS_CACHE_KEY, null);
  }

  function setCachedCorpus(record) {
    GM_setValue(BGG_CORPUS_CACHE_KEY, record);
  }

  function isCacheFresh(record, ttlDays) {
    if (!record || !record.fetched_at) return false;
    const ageMs = Date.now() - new Date(record.fetched_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) return false;
    return ageMs < ttlDays * 86400000;
  }

  // --- Manual-override cache helpers (consumed by Step 6's matcher UI) ------
  const OVERRIDE_PREFIX = 'override:';

  function getOverride(normalisedTitle) {
    return GM_getValue(OVERRIDE_PREFIX + normalisedTitle, undefined);
  }

  function setOverride(normalisedTitle, bggId) {
    GM_setValue(OVERRIDE_PREFIX + normalisedTitle, { id: bggId, ts: Date.now() });
  }

  // --- normaliseTitle -------------------------------------------------------
  // Writer-side normaliser. The Step 6 matcher MUST call the same function
  // (same name, same rules) so byNormName lookups are stable. Lowercase,
  // smart quotes folded to ASCII, every non-alphanumeric char becomes a
  // single space, then collapse + trim. Kept deliberately simple — the rich
  // js/06-matching.js normaliser depends on site-side runtime constants
  // (NOISE_TOKENS, SENTINEL_REPLACEMENTS) that don't exist in the userscript.
  function normaliseTitle(s) {
    if (!s) return '';
    let n = String(s).toLowerCase();
    // Smart quotes → ASCII equivalents. U+2018/U+2019 → ', U+201C/U+201D → ".
    n = n.replace(/[‘’]/g, "'");
    n = n.replace(/[“”]/g, '"');
    // Anything that isn't [a-z0-9] becomes a single space (this also strips
    // the apostrophes and quotes we just normalised — intentional, matches
    // BGG's "don't" → "dont" collapsing).
    n = n.replace(/[^a-z0-9]+/g, ' ');
    return n.trim();
  }

  // --- Step 1: scrape the signed S3 ZIP URL off the data_dumps page ---------
  // The href is rendered server-side on the authenticated page, so we do this
  // as the user (BGG session cookies travel with GM_xmlhttpRequest because
  // boardgamegeek.com is in @connect). The signed URL points at S3 and is
  // good for ~5 minutes — fetch the buffer immediately after.
  function fetchSignedZipUrl(signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url: BGG_RANKS_PAGE_URL,
        responseType: 'text',
        timeout: 30000,
        onload: (res) => {
          if (res.status === 401 || res.status === 403) {
            reject(new Error(
              'Not signed into BGG. Open https://boardgamegeek.com, sign in, ' +
              'then retry.'));
            return;
          }
          if (res.status !== 200) {
            reject(new Error(`HTTP ${res.status} fetching BGG ranks page`));
            return;
          }
          const html = res.responseText || '';
          // Same regex as tprmky/bgg-ranks-exporter.user.js — case-insensitive,
          // captures the first href ending in .zip (with optional query string
          // for the S3 signature).
          const m = html.match(/href\s*=\s*["']([^"']+\.zip[^"']*)["']/i);
          if (!m) {
            reject(new Error(
              'No .zip link on /data_dumps/bg_ranks — are you signed in to ' +
              'BGG in this browser?'));
            return;
          }
          let url = m[1].replace(/&amp;/g, '&');
          if (url.startsWith('//'))      url = 'https:' + url;
          else if (url.startsWith('/'))  url = 'https://boardgamegeek.com' + url;
          resolve(url);
        },
        onerror:   () => reject(new Error('Network error fetching BGG ranks page')),
        ontimeout: () => reject(new Error('Timeout fetching BGG ranks page'))
      });
      if (signal) {
        signal.addEventListener('abort', () => {
          try { req && req.abort && req.abort(); } catch (_) {}
          reject(new Error('aborted'));
        }, { once: true });
      }
    });
  }

  // --- Step 2: download the ZIP body as ArrayBuffer -------------------------
  function fetchZipBuffer(signedUrl, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(new Error('aborted')); return; }
      const req = GM_xmlhttpRequest({
        method: 'GET',
        url: signedUrl,
        responseType: 'arraybuffer',
        timeout: 180000,
        onload: (res) => {
          if (res.status !== 200) {
            reject(new Error(`HTTP ${res.status} downloading ZIP from ${signedUrl}`));
            return;
          }
          if (!res.response) {
            reject(new Error('Empty ZIP response body — Tampermonkey did not return an ArrayBuffer.'));
            return;
          }
          resolve(res.response);
        },
        onerror:   () => reject(new Error('Network error downloading BGG ZIP')),
        ontimeout: () => reject(new Error('Timeout downloading BGG ZIP'))
      });
      if (signal) {
        signal.addEventListener('abort', () => {
          try { req && req.abort && req.abort(); } catch (_) {}
          reject(new Error('aborted'));
        }, { once: true });
      }
    });
  }

  // --- Step 3: validate the buffer is actually a ZIP ------------------------
  // PKZIP files start with the local-file-header signature 0x504B0304. If we
  // got HTML back instead (auth lapsed mid-flow, S3 returned an error page,
  // etc.) include the first 200 bytes as text in the thrown error so the
  // diagnosis is obvious from the log.
  function validateZipBuffer(buf) {
    if (!buf || buf.byteLength < 4) {
      throw new Error(`Buffer too small to be a ZIP (${buf ? buf.byteLength : 0} bytes).`);
    }
    const head = new Uint8Array(buf);
    if (head[0] !== 0x50 || head[1] !== 0x4B) {
      const preview = new TextDecoder('utf-8', { fatal: false })
        .decode(buf.slice(0, Math.min(200, buf.byteLength)));
      throw new Error(
        `Buffer is not a ZIP (first bytes 0x${head[0].toString(16)} 0x${head[1].toString(16)}). ` +
        `First 200 chars: ${JSON.stringify(preview)}`);
    }
  }

  // --- Step 4: decompress with fflate ---------------------------------------
  function decompressZip(buf) {
    if (typeof fflate === 'undefined') {
      throw new Error('fflate library not loaded — check the @require URL is reachable.');
    }
    return fflate.unzipSync(new Uint8Array(buf));
  }

  // --- Step 5: extract the single CSV from the unzipped archive -------------
  function extractCsvText(decompressed) {
    const names = Object.keys(decompressed);
    const csvName = names.find((n) => /\.csv$/i.test(n));
    if (!csvName) {
      throw new Error(`No .csv inside ZIP. Files found: ${names.join(', ') || '(none)'}`);
    }
    let text = new TextDecoder('utf-8', { fatal: false }).decode(decompressed[csvName]);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text;
  }

  // --- Step 6: RFC-4180-ish CSV tokeniser -----------------------------------
  // Same loop as the legacy exporter: doubled-double-quote inside a quoted
  // field is an escaped ", a bare comma is a field separator, \n is a row
  // separator, \r is ignored. Returns rows as arrays of strings.
  function parseCsv(csvText) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      if (inQuotes) {
        if (ch === '"') {
          if (csvText[i + 1] === '"') { field += '"'; i++; }
          else                          inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"')        inQuotes = true;
        else if (ch === ',')  { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* skip */ }
        else                    field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // --- Step 7: shape rows to {id, primaryName, rank, average} ---------------
  function shapeRows(rows, maxRank) {
    if (!rows.length) throw new Error('CSV had no rows.');
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const cols = {
      id:      header.indexOf('id'),
      name:    header.indexOf('name'),
      rank:    header.indexOf('rank'),
      average: header.indexOf('average')
    };
    const missing = Object.entries(cols).filter(([, idx]) => idx < 0).map(([k]) => k);
    if (missing.length) {
      throw new Error(
        `CSV missing required columns: ${missing.join(', ')}. ` +
        `Found: ${header.join(', ')}`);
    }
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells || cells.length < header.length / 2) continue;
      const id   = parseInt(cells[cols.id], 10);
      const rank = parseInt(cells[cols.rank], 10);
      if (!Number.isFinite(id) || !Number.isFinite(rank)) continue;
      if (rank <= 0 || rank > maxRank) continue;
      const avg = parseFloat(cells[cols.average]);
      out.push({
        id,
        primaryName: cells[cols.name],
        rank,
        average: Number.isFinite(avg) ? avg : null
      });
    }
    out.sort((a, b) => a.rank - b.rank);
    return out;
  }

  // --- Step 8: build the in-memory indexes ---------------------------------
  // Mirrors js/05-bgg-cache.js so the Step 6 matcher can reuse its tier-1
  // and tier-2 logic verbatim. byNormName is first-wins on collision (lower
  // rank rows are processed first because shapeRows sorts ascending). The
  // token inverted index lets the matcher narrow tier-2 candidates without
  // scanning the whole corpus.
  function buildIndexes(games) {
    const byId = new Map();
    const byNormName = new Map();
    const nameEntries = [];
    for (const g of games) {
      byId.set(g.id, g);
      const norm = normaliseTitle(g.primaryName || '');
      if (!norm) continue;
      if (!byNormName.has(norm)) byNormName.set(norm, g);
      const tokens = norm.split(' ').filter(Boolean);
      if (!tokens.length) continue;
      nameEntries.push({
        id: g.id,
        normName: norm,
        tokens,
        rank: (typeof g.rank === 'number' && g.rank > 0)
          ? g.rank
          : Number.POSITIVE_INFINITY
      });
    }
    const tokenToEntryIdx = new Map();
    for (let i = 0; i < nameEntries.length; i++) {
      for (const t of nameEntries[i].tokens) {
        let bucket = tokenToEntryIdx.get(t);
        if (!bucket) { bucket = new Set(); tokenToEntryIdx.set(t, bucket); }
        bucket.add(i);
      }
    }
    // Build the tier-3 Fuse index ONCE here. Reconstructing per matchTitle()
    // call costs ~50–200ms per ~5k-entry index; multiplying that across ~2k
    // tier-3 fallbacks added minutes of pure index-construction to a run.
    const fuse = (typeof Fuse !== 'undefined')
      ? new Fuse(nameEntries, {
          keys: ['normName'],
          threshold: FUZZY_MATCH_THRESHOLD,
          ignoreLocation: true,
          minMatchCharLength: 3,
          includeScore: true
        })
      : null;
    log('info', `Tier-3 Fuse index built (${nameEntries.length} entries)`);
    return { byId, byNormName, nameEntries, tokenToEntryIdx, fuse };
  }

  // --- Phase entry point ----------------------------------------------------
  // Either reuses the GM-cached corpus (when fresh and force-refresh isn't
  // set) or pulls a fresh ZIP from BGG. Always rebuilds the in-memory
  // indexes onto BSNZ.bgg_corpus regardless of which path we took, because
  // they're the structures the matcher consumes and they aren't worth
  // serialising across runs.
  async function runCorpusRefreshPhase(signal) {
    const ttlDays = BSNZ.config.bgg_corpus_cache_ttl_days;
    const maxRank = BSNZ.config.bgg_corpus_max_rank;
    const force   = !!BSNZ.config.bgg_corpus_force_refresh;
    const cached  = getCachedCorpus();
    // Capture before any state mutation so the run-history record reflects
    // the actual decision (cache vs network).
    const wasCacheHit = !force && isCacheFresh(cached, ttlDays);
    runHistoryStartPhase('bgg_corpus_refresh');

    let record;
    if (!force && isCacheFresh(cached, ttlDays)) {
      record = cached;
      log('info',
        `Using cached BGG corpus (${record.game_count} games, fetched ${record.fetched_at})`);
    } else {
      log('info', force
        ? 'Forced BGG corpus refresh — fetching fresh ZIP'
        : 'BGG corpus stale or missing — fetching fresh ZIP');
      const signedUrl = await fetchSignedZipUrl(signal);
      log('info', `Resolved signed BGG ZIP URL: ${signedUrl.split('?')[0]}…`);
      const buf = await fetchZipBuffer(signedUrl, signal);
      log('info', `Downloaded ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB ZIP`);
      validateZipBuffer(buf);
      const decompressed = decompressZip(buf);
      const csvText      = extractCsvText(decompressed);
      const rows         = parseCsv(csvText);
      const games        = shapeRows(rows, maxRank);
      record = {
        fetched_at:     new Date().toISOString(),
        source_zip_url: signedUrl,
        game_count:     games.length,
        games
      };
      setCachedCorpus(record);
      if (force) saveConfigKey('bgg_corpus_force_refresh', false);
      log('info', `Refreshed BGG corpus: ${record.game_count} games (top rank ${maxRank})`);
    }

    const idx = buildIndexes(record.games);
    BSNZ.bgg_corpus = {
      ...idx,
      games:      record.games,
      fetched_at: record.fetched_at
    };
    BSNZ.stats.bgg_corpus_size = record.games.length;
    log('info',
      `Corpus indexed: ${idx.byNormName.size} normalised names, ` +
      `${idx.tokenToEntryIdx.size} unique tokens`);
    runHistoryEndPhase('bgg_corpus_refresh', {
      games_count: record.games.length,
      cache_hit: wasCacheHit
    });
  }
