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

  // ─────────────────────────────────────────────────────────────────────────
  // politeSleep — anti-detection humanization (v0.7.14, presets v0.7.15)
  // ─────────────────────────────────────────────────────────────────────────
  // Every numeric tunable referenced here lives in CRAWL_SPEED_PRESETS in
  // 01-constants.js, looked up at use-time via getActivePresetConfig() so a
  // mid-crawl preset switch (via the dashboard slider) affects every
  // SUBSEQUENT request — already-in-flight `await sleep(…)` calls are not
  // shortened or extended retroactively.
  //
  // Distribution. Let mean = settings.politeDelayMs * cfg.delayMultiplier.
  // Each call draws delta = mean * (avg(r1, r2, r3) * R + (1 - R/2))
  // where rN ~ U(0,1) and R = cfg.delayJitterRange. The triangular-ish
  // kernel `avg(r1,r2,r3)` has mean 0.5 so E[delta] = mean for any R; R
  // controls width only. Post-clamp bounds: [mean * cfg.delayLoMult,
  // mean * cfg.delayHiMult]. Triangular sums concentrate tightly around the
  // mean so clamping has negligible effect on the expected value.
  //
  // Human pauses. Once every cfg.humanPauseFrequency calls, with probability
  // cfg.humanPauseProbability the call emits a long pause of cfg.humanPauseMultMin..Max
  // x mean (uniform), simulating the user getting distracted. The EXTRA
  // time is tracked in `_politeSleepDebt` and refunded by SHORTENING the
  // next cfg.humanPauseCompensationRequests sleeps proportionally; the
  // floor is 50ms so we still yield. For FASTEST and BALANCED, this keeps
  // the running average unchanged. For SAFEST the larger pause magnitudes
  // and tighter compensation count produce a small net increase in mean
  // delay — by design, since safest mode is supposed to slow things down.
  let _politeSleepDebt = 0;             // ms still owed (positive => shorten next sleeps)
  let _politeSleepCounter = 0;          // request counter for human-pause cadence
  let _politeSleepCompensationLeft = 0; // sleeps remaining over which to spread the debt

  async function politeSleep() {
    const cfg = getActivePresetConfig();
    const s = settings.get();
    const mean = (s.politeDelayMs || 800) * cfg.delayMultiplier;
    _politeSleepCounter++;

    // Triangular kernel, mean 0.5, scaled+shifted to mean = `mean` with
    // configurable spread (cfg.delayJitterRange).
    const triKernel = (Math.random() + Math.random() + Math.random()) / 3;
    const R = cfg.delayJitterRange;
    let delta = mean * (triKernel * R + (1 - R / 2));

    // Clamp tails — triangular sums concentrate around the mean so this
    // trims a very small fraction of draws and barely shifts E[delta].
    const lo = mean * cfg.delayLoMult;
    const hi = mean * cfg.delayHiMult;
    if (delta < lo) delta = lo;
    if (delta > hi) delta = hi;

    // Inject a long human pause occasionally, randomized so the cadence
    // itself isn't periodic. When emitted, store the EXTRA time as debt to
    // be refunded across the next N sleeps.
    if (_politeSleepCompensationLeft === 0 &&
        _politeSleepCounter % cfg.humanPauseFrequency === 0 &&
        Math.random() < cfg.humanPauseProbability) {
      const mult = cfg.humanPauseMultMin + Math.random() * (cfg.humanPauseMultMax - cfg.humanPauseMultMin);
      const longPause = mean * mult;
      _politeSleepDebt += (longPause - delta);  // EXTRA time vs the sleep we would have done
      _politeSleepCompensationLeft = cfg.humanPauseCompensationRequests;
      delta = longPause;
    } else if (_politeSleepCompensationLeft > 0 && _politeSleepDebt > 0) {
      // Refund: shorten this sleep by debt/remaining so the spread is even.
      const refund = _politeSleepDebt / _politeSleepCompensationLeft;
      delta -= refund;
      _politeSleepDebt -= refund;
      _politeSleepCompensationLeft--;
      if (delta < 50) delta = 50;  // tiny floor so we still yield
    }

    await sleep(delta);
  }

  // Fisher-Yates in-place shuffle. Used by 11-orchestrators.js to randomise
  // the (subcat × condition) pass order per run (v0.7.14 anti-detection).
  function fisherYatesShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Pick a random element from an array. Used by 07-network.js to rotate
  // Accept-Language / Accept headers per-request.
  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

