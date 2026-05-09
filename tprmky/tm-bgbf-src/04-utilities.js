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
  // politeSleep — anti-detection humanization (v0.7.14)
  // ─────────────────────────────────────────────────────────────────────────
  // Mean delay is preserved across a run; only the per-call DISTRIBUTION
  // changes vs the v0.7.13 fixed-mean+uniform-jitter scheme.
  //
  // Distribution. Let X = settings.politeDelayMs (default 800). Each call
  // draws delta = X * (avg(r1, r2, r3) * 2.4 - 0.2)  where rN ~ U(0,1).
  // The triangular-ish kernel `avg(r1,r2,r3)` has mean 0.5, so:
  //   E[delta] = X * (0.5 * 2.4 - 0.2)
  //            = X * (1.2 - 0.2)
  //            = X
  // and the support is [X*-0.2, X*2.2] which we clamp to [0.4·X, 1.6·X]
  // post-hoc — clamp tails are statistically rare (a triangular sum sits
  // tightly around the mean) so clamping has negligible effect on the
  // expected value. Net result: same mean as v0.7.13, much wider variance,
  // and a non-uniform shape that is harder to fingerprint than U(0, J).
  //
  // Human pauses. Once every HUMAN_PAUSE_FREQUENCY calls (≈1-in-32,
  // randomized so the cadence isn't itself periodic), emit a long pause of
  // 3×–6× X simulating the user getting distracted. The extra time is
  // tracked in `_politeSleepDebt` and offset by SHORTENING the next
  // HUMAN_PAUSE_COMPENSATION_REQUESTS (=3) sleeps proportionally, so the
  // running average across any window ≥ ~32 requests is unchanged. If a
  // compensated sleep would go negative we floor it at 50ms so we still
  // briefly yield to the event loop. The floor is small enough that the
  // residual drift across a typical 200-request run is well under 1%.
  //
  // No change here increases the AVERAGE delay between requests across a
  // run; the human-pause time is precisely accounted for and refunded by
  // the compensation pool.
  let _politeSleepDebt = 0;             // ms still owed (positive => shorten next sleeps)
  let _politeSleepCounter = 0;          // request counter for human-pause cadence
  let _politeSleepCompensationLeft = 0; // sleeps remaining over which to spread the debt

  async function politeSleep() {
    const s = settings.get();
    const X = s.politeDelayMs || 800;
    _politeSleepCounter++;

    // Triangular kernel, mean 0.5, scaled+shifted to mean=X with support
    // approximately [-0.2X, 2.2X] before clamping.
    const triKernel = (Math.random() + Math.random() + Math.random()) / 3;
    let delta = X * (triKernel * 2.4 - 0.2);

    // Clamp tails — triangular sums concentrate around the mean so this
    // trims a very small fraction of draws and barely shifts E[delta].
    const lo = X * 0.4;
    const hi = X * 1.6;
    if (delta < lo) delta = lo;
    if (delta > hi) delta = hi;

    // Inject a long human pause occasionally, randomized so the cadence
    // itself isn't periodic. When emitted, store the EXTRA time as debt to
    // be refunded across the next N sleeps.
    if (_politeSleepCompensationLeft === 0 &&
        _politeSleepCounter % HUMAN_PAUSE_FREQUENCY === 0 &&
        Math.random() < 0.5) {
      const mult = HUMAN_PAUSE_MULT_MIN + Math.random() * (HUMAN_PAUSE_MULT_MAX - HUMAN_PAUSE_MULT_MIN);
      const longPause = X * mult;
      _politeSleepDebt += (longPause - delta);  // EXTRA time vs the sleep we would have done
      _politeSleepCompensationLeft = HUMAN_PAUSE_COMPENSATION_REQUESTS;
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

