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

