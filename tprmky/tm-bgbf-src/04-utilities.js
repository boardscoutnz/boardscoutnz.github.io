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

  async function politeSleep() {
    const s = settings.get();
    const jitter = Math.random() * (s.politeDelayJitterMs || 0);
    await sleep((s.politeDelayMs || 800) + jitter);
  }

