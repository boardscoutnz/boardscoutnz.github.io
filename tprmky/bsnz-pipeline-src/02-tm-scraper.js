// tprmky/bsnz-pipeline-src/02-tm-scraper.js
// ===== TM scraper module =====
// Inputs:  TM_SUBCATS (from 00-config.js) — 8 hardcoded subcategory paths.
// Outputs: BSNZ.tm_listings = [ {tm_id, tm_url, tm_title, ..., tm_subcat}, ... ]
// Side effects: updates BSNZ.stats.tm_scraped, calls log() and updateProgress().
//
// Runs inside the shared IIFE opened in 00-config.js — so TM_REQUEST_DELAY_MS,
// TM_ORIGIN, TM_SUBCATS, BSNZ, log, etc. resolve from closure scope.
//
// Extraction strategy. The legacy TM scraper (tprmky/tm-bgbf-src/) showed
// that TM's search-result pages are Next.js-rendered: the listing array is
// embedded as JSON inside <script id="__NEXT_DATA__">, with a DOM card
// fallback when that script is absent. We re-use that two-tier approach
// here, but emit the bsnz.json record shape (tm_id / tm_url / tm_title /
// tm_price_nzd / tm_buy_now_nzd / tm_condition / tm_location / tm_subcat) —
// see docs/13-pipeline-pre-merged-data.md.

  async function runScrapePhase(signal) {
    log('info', 'TM scrape phase starting');
    BSNZ.tm_listings = [];
    BSNZ.stats.tm_scraped = 0;
    // Dedupe lives outside the subcat loop: first-subcat-wins, so a listing
    // that appears in both card-games and games-puzzles-other (TM lets sellers
    // cross-list) is tagged with the slug it was first seen in.
    const seen = new Set();

    for (let i = 0; i < TM_SUBCATS.length; i++) {
      const subcat = TM_SUBCATS[i];
      let pageUrl = TM_ORIGIN + subcat.path;
      let pageNum = 1;
      while (pageUrl) {
        if (signal.aborted) throw new Error('aborted');
        log('info', `Fetching ${subcat.slug} page ${pageNum}: ${pageUrl}`);
        const html = await fetchTMPageHtml(pageUrl, signal);
        const { listings, nextUrl } = parseTMListingsPage(html, pageUrl);
        let added = 0;
        for (const listing of listings) {
          if (seen.has(listing.tm_id)) continue;
          seen.add(listing.tm_id);
          listing.tm_subcat = subcat.slug;
          BSNZ.tm_listings.push(listing);
          added++;
        }
        BSNZ.stats.tm_scraped = BSNZ.tm_listings.length;
        tmUpdateProgress('scrape', { subcat: subcat.slug, pageNum, addedCount: added });
        if (added === 0) {
          log('info', `${subcat.slug}: no new listings on page ${pageNum} (TM page-end overshoot) — moving to next subcat after ${pageNum} page(s).`);
          break;
        }
        if (pageNum >= TM_MAX_PAGES_PER_SUBCAT) {
          log('warn', `${subcat.slug}: hit hard cap of ${TM_MAX_PAGES_PER_SUBCAT} pages — stopping. Investigate whether this subcat genuinely has more listings.`);
          break;
        }
        pageUrl = nextUrl;
        pageNum++;
        if (pageUrl) {
          await tmSleep(BSNZ.config.pacing_multiplier * TM_REQUEST_DELAY_MS, signal);
        }
      }
      // Pace between subcats too — back-to-back hits on the same TM origin
      // would defeat the polite-rate guard. Skip the trailing sleep after the
      // last subcat so the phase ends promptly.
      if (i < TM_SUBCATS.length - 1) {
        await tmSleep(BSNZ.config.pacing_multiplier * TM_REQUEST_DELAY_MS, signal);
      }
    }
    log('info', `TM scrape complete: ${BSNZ.tm_listings.length} listings across ${TM_SUBCATS.length} subcats`);
  }

  // GM_xmlhttpRequest doesn't accept an AbortSignal natively; it returns a
  // handle with .abort(). Bridge the signal manually so cancel propagates.
  function fetchTMPageHtml(url, signal) {
    return new Promise((resolve, reject) => {
      let aborted = false;
      const handle = GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { 'Accept': 'text/html' },
        timeout: 30000,
        onload: (r) => {
          if (aborted) return;
          if (r.status === 200) resolve(r.responseText);
          else reject(new Error('TM HTTP ' + r.status));
        },
        onerror: (e) => {
          if (aborted) return;
          reject(new Error('TM network error: ' + ((e && e.error) || 'unknown')));
        },
        ontimeout: () => {
          if (aborted) return;
          reject(new Error('TM request timeout'));
        }
      });
      if (signal) {
        const onAbort = () => {
          aborted = true;
          try { if (handle && typeof handle.abort === 'function') handle.abort(); } catch (_) {}
          reject(new Error('aborted'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  function parseTMListingsPage(html, sourceUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    let rawListings = [];
    let totalCount = null;
    const nd = extractNextData(doc);
    if (nd) {
      const arr = findListingArrayInJson(nd);
      if (arr && arr.length) {
        rawListings = arr;
        totalCount = pickFirstPath(nd, [
          'props.pageProps.totalCount',
          'props.pageProps.searchResults.totalCount',
          'props.pageProps.results.totalCount',
          'props.pageProps.listings.totalCount',
          'props.pageProps.searchResults.foundItems'
        ]);
      }
    }

    let listings;
    if (rawListings.length) {
      listings = rawListings.map(normaliseTmListing).filter(Boolean);
    } else {
      listings = scrapeTmDomCards(doc);
    }

    const nextUrl = computeNextUrl(sourceUrl, listings.length, totalCount);
    return { listings, nextUrl };
  }

  function extractNextData(doc) {
    const el = doc.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent); } catch (_) { return null; }
  }

  // BFS for the longest array of objects whose elements look like listings
  // (have a listingId / ListingId field). Mirrors the legacy
  // findListingArraysInJson() heuristic but returns the single best array.
  function findListingArrayInJson(root) {
    const found = [];
    const stack = [root];
    const visited = new WeakSet();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || visited.has(node)) continue;
      visited.add(node);
      if (Array.isArray(node)) {
        if (node.length && typeof node[0] === 'object' && node[0] &&
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

  function getPath(obj, path) {
    if (obj == null) return undefined;
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function pickFirst(obj, keys) {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== '') return v;
    }
    return undefined;
  }

  function pickFirstPath(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (v != null && v !== '') return v;
    }
    return null;
  }

  function toNum(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parsePriceText(text) {
    if (!text) return null;
    const m = String(text).match(/\$\s*([\d,]+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function cleanLocation(s) {
    if (s == null) return null;
    let cleaned = String(s)
      .split(/\s*(?:Closes|Closing|Listed|Ends|Started|Closed)\b/i)[0]
      .split(/[—–]/)[0]
      .replace(/^[\s·•,|]+|[\s·•,|]+$/g, '')
      .trim();
    return cleaned || null;
  }

  // Map TM's raw __NEXT_DATA__ listing object to the bsnz.json TM-sourced
  // field shape. Field-name candidates mirror tm-bgbf-src/09-normaliser.js.
  function normaliseTmListing(raw) {
    if (!raw) return null;
    const idRaw = pickFirst(raw, ['listingId', 'ListingId', 'id']);
    const idNum = toNum(idRaw);
    if (!idNum) return null;
    const tm_id = String(idNum);

    const tm_title = String(pickFirst(raw, ['title', 'Title', 'name']) || '').trim();
    if (!tm_title) return null;

    const startPrice = toNum(pickFirst(raw, [
      'startPrice', 'StartPrice', 'currentBid', 'CurrentBid',
      'currentPrice', 'CurrentPrice', 'minimumNextBid', 'MinimumNextBid'
    ]));
    const buyNow = toNum(pickFirst(raw, ['buyNowPrice', 'BuyNowPrice', 'buyNow', 'BuyNow']));
    const priceDisplay = pickFirst(raw, ['priceDisplay', 'PriceDisplay', 'displayPrice', 'DisplayPrice']);
    const tm_price_nzd = startPrice ?? buyNow ?? parsePriceText(priceDisplay);
    const tm_buy_now_nzd = buyNow;

    const conditionRaw = String(pickFirst(raw, ['condition', 'Condition']) || '').toLowerCase();
    const tm_condition = conditionRaw === 'new' ? 'New'
                       : conditionRaw === 'used' ? 'Used'
                       : '';

    const tm_location = cleanLocation(pickFirst(raw, [
      'region', 'Region', 'regionName', 'RegionName', 'location', 'Location'
    ])) || '';

    const tm_url = `${TM_ORIGIN}/a/marketplace/listing/${tm_id}`;

    return { tm_id, tm_url, tm_title, tm_price_nzd, tm_buy_now_nzd, tm_condition, tm_location };
  }

  // DOM-cards fallback (used when __NEXT_DATA__ is missing or empty).
  // Selectors ported from tm-bgbf-src/08-extraction.js scrapeDomCards().
  function scrapeTmDomCards(doc) {
    const out = [];
    const cards = doc.querySelectorAll(
      'a[href*="/listing/"], [data-testid*="search-card"], [class*="search-card"]'
    );
    const seen = new Set();
    cards.forEach((node) => {
      const a = node.tagName === 'A' ? node : node.querySelector('a[href*="/listing/"]');
      const dataId = node.getAttribute && node.getAttribute('data-listing-id');
      let id = dataId;
      if (!id && a) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/listing\/(\d+)/);
        if (m) id = m[1];
      }
      if (!id || seen.has(id)) return;
      seen.add(id);

      const tm_title = (node.querySelector('h3, [class*="title"]')?.textContent ||
                        a?.getAttribute('title') || '').trim();
      if (!tm_title) return;
      const priceText = (node.querySelector('[class*="price"]')?.textContent || '').trim();
      const tm_price_nzd = parsePriceText(priceText);
      const locRaw = (node.querySelector('[class*="location"], [class*="region"]')?.textContent || '').trim();
      const tm_location = cleanLocation(locRaw) || '';
      const tm_url = `${TM_ORIGIN}/a/marketplace/listing/${id}`;

      out.push({
        tm_id: String(id),
        tm_url,
        tm_title,
        tm_price_nzd,
        tm_buy_now_nzd: null,
        tm_condition: '',
        tm_location
      });
    });
    return out;
  }

  // TM paginates via ?page=N. Increment until a page returns zero listings,
  // or until cumulative count reaches totalCount, whichever comes first.
  function computeNextUrl(currentUrl, listingsThisPage, totalCount) {
    if (!listingsThisPage) return null;
    let u;
    try { u = new URL(currentUrl); } catch (_) { return null; }
    const curPage = parseInt(u.searchParams.get('page') || '1', 10) || 1;
    if (totalCount && BSNZ.stats.tm_scraped >= totalCount) return null;
    u.searchParams.set('page', String(curPage + 1));
    return u.toString();
  }

  function tmSleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        }, { once: true });
      }
    });
  }

  function tmUpdateProgress(phase, info) {
    if (typeof window.bsnzUpdateProgress === 'function') {
      window.bsnzUpdateProgress(phase, {
        ...info,
        total: BSNZ.stats.tm_scraped
      });
    }
  }

