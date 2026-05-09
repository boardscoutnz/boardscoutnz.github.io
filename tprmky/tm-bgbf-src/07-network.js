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
          // v0.7.14 / v0.7.15: multiplicative-jitter exp backoff. The
          // jitter window is preset-dependent — see CRAWL_SPEED_PRESETS in
          // 01-constants.js. Read at use-time so a mid-crawl preset switch
          // affects subsequent retries.
          const cfg = getActivePresetConfig();
          const base = clamp(800 * Math.pow(2, attempt), 1500, 30000);
          const mult = cfg.retryJitterMin + Math.random() * (cfg.retryJitterMax - cfg.retryJitterMin);
          const backoff = base * mult;
          await sleep(backoff);
        }
      }
    }
    throw lastError || new Error('fetchHtml exhausted retries');
  }

