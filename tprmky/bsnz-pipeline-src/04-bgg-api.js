// tprmky/bsnz-pipeline-src/04-bgg-api.js
// ===== BGG XML /thing API client =====
// Inputs:  BGG_API_BASE, BGG_API_REQUEST_DELAY_MS (00-config.js).
// Outputs: array of {bgg_id, bgg_weight, bgg_min_players, bgg_max_players,
//                    bgg_playing_time, bgg_min_age, bgg_categories,
//                    bgg_mechanics} from bggFetchThings(ids, signal).
//
// Runs inside the shared IIFE opened in 00-config.js. Dormant after Step 5 —
// no call site for bggFetchThings exists yet. Step 7's orchestrator wires it
// in conditionally on BSNZ.config.enable_bgg_api_enrichment.

  // --- Low-level GET with BGG-friendly retry logic --------------------------
  // BGG's xmlapi2 returns HTTP 202 ("queued") for batches it hasn't processed
  // yet — the documented protocol is to wait a few seconds and retry. We also
  // back off on 429 / 5xx, capped so a single batch's total wait is ≤60s.
  function bggGetXmlWithRetry(url, signal) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      let totalWaitMs = 0;
      const MAX_TOTAL_WAIT_MS = 60000;
      const MAX_QUEUE_ATTEMPTS = 5;

      const sleep = (ms) => new Promise((res, rej) => {
        if (signal && signal.aborted) { rej(new Error('aborted')); return; }
        const t = setTimeout(res, ms);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            rej(new Error('aborted'));
          }, { once: true });
        }
      });

      const attemptOnce = () => {
        if (signal && signal.aborted) { reject(new Error('aborted')); return; }
        attempt++;
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'text',
          timeout: 60000,
          onload: async (res) => {
            try {
              if (res.status === 200) {
                resolve(res.responseText || '');
                return;
              }
              if (res.status === 202) {
                if (attempt >= MAX_QUEUE_ATTEMPTS) {
                  reject(new Error(
                    `BGG /thing still queued after ${MAX_QUEUE_ATTEMPTS} attempts: ${url}`));
                  return;
                }
                // 2s, 3s, 4s, 5s — cumulative ≤14s before the cap kicks in.
                const wait = (attempt + 1) * 1000;
                await sleep(wait);
                attemptOnce();
                return;
              }
              if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
                const wait = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                if (totalWaitMs + wait > MAX_TOTAL_WAIT_MS) {
                  reject(new Error(
                    `BGG /thing HTTP ${res.status} repeated; total backoff cap reached`));
                  return;
                }
                totalWaitMs += wait;
                await sleep(wait);
                attemptOnce();
                return;
              }
              const body = (res.responseText || '').slice(0, 200);
              reject(new Error(`BGG /thing HTTP ${res.status}: ${body}`));
            } catch (e) {
              reject(e);
            }
          },
          onerror:   () => reject(new Error(`Network error fetching ${url}`)),
          ontimeout: () => reject(new Error(`Timeout fetching ${url}`))
        });
      };

      attemptOnce();
    });
  }

  // --- Helpers for picking values out of an <item> element ------------------
  function _intAttr(parent, sel, attr) {
    const el = parent.querySelector(sel);
    if (!el) return null;
    const v = parseInt(el.getAttribute(attr), 10);
    return Number.isFinite(v) ? v : null;
  }

  function _floatAttr(parent, sel, attr) {
    const el = parent.querySelector(sel);
    if (!el) return null;
    const v = parseFloat(el.getAttribute(attr));
    return Number.isFinite(v) ? v : null;
  }

  function _linkValues(itemEl, type) {
    const out = [];
    const links = itemEl.querySelectorAll(`link[type="${type}"]`);
    for (const l of links) {
      const v = l.getAttribute('value');
      if (v) out.push(v);
    }
    return out;
  }

  // --- Per-item shape -------------------------------------------------------
  function parseThingItem(el) {
    const idAttr = parseInt(el.getAttribute('id'), 10);
    return {
      bgg_id:           Number.isFinite(idAttr) ? idAttr : null,
      bgg_weight:       _floatAttr(el, 'statistics > ratings > averageweight', 'value'),
      bgg_min_players:  _intAttr  (el, 'minplayers',   'value'),
      bgg_max_players:  _intAttr  (el, 'maxplayers',   'value'),
      bgg_playing_time: _intAttr  (el, 'playingtime',  'value'),
      bgg_min_age:      _intAttr  (el, 'minage',       'value'),
      bgg_categories:   _linkValues(el, 'boardgamecategory'),
      bgg_mechanics:    _linkValues(el, 'boardgamemechanic')
    };
  }

  // --- Public batch entry point ---------------------------------------------
  // Splits ids into chunks of 20 (BGG's documented soft limit for /thing),
  // calls bggGetXmlWithRetry per chunk, parses the response with DOMParser,
  // and concatenates the per-item shapes. Pacing between batches honours
  // BSNZ.config.pacing_multiplier so a user can throttle if BGG is unhappy.
  async function bggFetchThings(ids, signal) {
    const out = [];
    if (!ids || !ids.length) return out;
    const BATCH_SIZE = 20;
    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE));
    }
    const pacing = (BSNZ.config.pacing_multiplier || 1) * BGG_API_REQUEST_DELAY_MS;
    for (let b = 0; b < batches.length; b++) {
      if (signal && signal.aborted) throw new Error('aborted');
      const batch = batches[b];
      const url = `${BGG_API_BASE}/thing?id=${batch.join(',')}&stats=1`;
      const xml = await bggGetXmlWithRetry(url, signal);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const items = doc.querySelectorAll('items > item');
      for (const el of items) out.push(parseThingItem(el));
      if (typeof window.bsnzUpdateProgress === 'function') {
        window.bsnzUpdateProgress('bgg_api', { done: b + 1, total: batches.length });
      }
      if (b < batches.length - 1) {
        await new Promise((res, rej) => {
          if (signal && signal.aborted) { rej(new Error('aborted')); return; }
          const t = setTimeout(res, pacing);
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(t);
              rej(new Error('aborted'));
            }, { once: true });
          }
        });
      }
    }
    return out;
  }
