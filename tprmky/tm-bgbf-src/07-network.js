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
        const res = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'text/html,application/xhtml+xml' },
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
          const backoff = clamp(800 * Math.pow(2, attempt), 1500, 30000) + Math.random() * 500;
          await sleep(backoff);
        }
      }
    }
    throw lastError || new Error('fetchHtml exhausted retries');
  }

