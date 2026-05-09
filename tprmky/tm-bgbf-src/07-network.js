  // ============================================================================
  // 6. NETWORK FETCHER
  // ============================================================================

  async function fetchHtml(url, opts = {}) {
    const s = settings.get();
    const { maxAttempts = 4, timeoutMs = s.fetchTimeoutMs || 30000 } = opts;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => { try { controller.abort(); } catch {} }, timeoutMs);
      const t0 = Date.now();
      log(`fetchHtml attempt ${attempt}/${maxAttempts}: ${url}`);
      try {
        // v0.7.14: rotate Accept and Accept-Language across small NZ-plausible
        // pools per request so every fetch's header fingerprint isn't identical.
        const headers = {
          'Accept': pickRandom(ACCEPT_HEADER_POOL),
          'Accept-Language': pickRandom(ACCEPT_LANGUAGE_POOL),
        };
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers,
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (giving up)`);
        const text = await res.text();
        const elapsed = Date.now() - t0;
        if (/<title[^>]*>\s*(Just a moment|Attention Required|Access denied|Cloudflare)\b/i.test(text)) {
          warn(`fetchHtml challenge page detected after ${elapsed}ms for ${url}`);
          throw new Error('challenge-page-detected');
        }
        log(`fetchHtml OK in ${elapsed}ms, ${text.length} bytes`);
        return text;
      } catch (e) {
        clearTimeout(timer);
        const elapsed = Date.now() - t0;
        lastError = e;
        if (e && e.name === 'AbortError') {
          warn(`fetchHtml attempt ${attempt} TIMEOUT after ${elapsed}ms (limit ${timeoutMs}ms): ${url}`);
          lastError = new Error(`fetch-timeout-${timeoutMs}ms`);
        } else {
          warn(`fetchHtml attempt ${attempt} failed after ${elapsed}ms for ${url}:`, e.message || e);
        }
        if (e && e.message === 'challenge-page-detected') throw e;
        if (attempt < maxAttempts) {
          // v0.7.14: multiplicative jitter (×0.7..×1.4) instead of an
          // additive 0..500ms cap. E[multiplier] = 1.05 ≈ same expected
          // wait as the previous "+0..500" added to a 1500..30000 base
          // (which averaged ~250ms extra), but with proportionally-wider
          // spread so retries from many parallel runs don't cluster.
          const base = clamp(800 * Math.pow(2, attempt), 1500, 30000);
          const mult = 0.7 + Math.random() * 0.7;
          const backoff = base * mult;
          await sleep(backoff);
        }
      }
    }
    throw lastError || new Error('fetchHtml exhausted retries');
  }

