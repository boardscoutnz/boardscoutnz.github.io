// ==UserScript==
// @name         BGG Ranks Exporter (Board Scout NZ)
// @namespace    https://github.com/boardscoutnz
// @version      0.2.0
// @description  Download the BGG ranks CSV, filter to top-N by rank, emit bgg-cache.json for Board Scout NZ. Verbose console logging for diagnostics.
// @author       Gavin McGruddy
// @match        https://boardgamegeek.com/*
// @match        https://www.boardgamegeek.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      boardgamegeek.com
// @connect      *.boardgamegeek.com
// @connect      *.amazonaws.com
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // 1. Constants
  // =========================================================================

  const SCRIPT_NAME     = 'BGG Ranks Exporter';
  const VERSION         = '0.2.0';
  const RANKS_PAGE_URL  = 'https://boardgamegeek.com/data_dumps/bg_ranks';
  const DEFAULT_MAX     = 5000;
  const STORAGE_KEY     = 'bsnz-bgg-export-max-rank';
  const OUTPUT_FILENAME        = 'bgg-rankings.json';
  const SAMPLE_OUTPUT_FILENAME = 'bgg-rankings-example.json';
  const SAMPLE_SIZE            = 100;

  // =========================================================================
  // 2. Logging — every public-ish step in the pipeline emits at least one
  //    tagged line. Filter the DevTools console for "[bsnz-bgg]" to see
  //    everything from this script, or "[bsnz-bgg][csv-parse]" (etc.) to
  //    isolate one stage. Categories used:
  //      init, ui, status, input, fetch, zip-validate, unzip,
  //      csv-extract, csv-parse, filter, json, download, export
  // =========================================================================

  const LOG_PREFIX = 'bsnz-bgg';
  const _tag = (cat) => `[${LOG_PREFIX}][${cat}]`;
  const log  = (cat, ...a) => console.log(_tag(cat), ...a);
  const warn = (cat, ...a) => console.warn(_tag(cat), ...a);
  const err  = (cat, ...a) => console.error(_tag(cat), ...a);
  const grp  = (cat, label) => console.group(`${_tag(cat)} ${label}`);
  const grpEnd = () => console.groupEnd();
  const startTimer = () => {
    const t0 = performance.now();
    return () => `${(performance.now() - t0).toFixed(0)}ms`;
  };

  // =========================================================================
  // 3. Bootstrap diagnostics — log everything we know about the environment
  //    at script load so future debugging has the basics on hand.
  // =========================================================================

  log('init', `${SCRIPT_NAME} v${VERSION} userscript loaded.`);
  log('init', `Page URL: ${location.href}`);
  log('init', `Document readyState: ${document.readyState}`);
  log('init', `User agent: ${navigator.userAgent}`);

  // fflate comes in via @require. If the CDN is blocked the global will be
  // missing and we surface it immediately rather than letting the user find
  // out mid-export.
  if (typeof fflate === 'undefined') {
    err('init', 'fflate library is NOT loaded — the @require URL may be unreachable.');
    err('init', 'Menu command will register, but unzipping will fail with a clear error.');
  } else {
    log('init', 'fflate loaded.', {
      hasUnzipSync: typeof fflate.unzipSync === 'function',
      hasUnzip:     typeof fflate.unzip     === 'function',
      hasStrFromU8: typeof fflate.strFromU8 === 'function',
    });
  }

  log('init', 'Tampermonkey GM API availability:', {
    GM_xmlhttpRequest:      typeof GM_xmlhttpRequest      !== 'undefined',
    GM_registerMenuCommand: typeof GM_registerMenuCommand !== 'undefined',
    GM_addStyle:            typeof GM_addStyle            !== 'undefined',
  });

  // =========================================================================
  // 4. Menu command registration
  // =========================================================================

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(`📊 ${SCRIPT_NAME}`, () => {
      log('ui', 'Tampermonkey menu command activated by user.');
      openModal();
    });
    log('init', 'Menu command registered.');
  } else {
    err('init', 'GM_registerMenuCommand not available — script not reachable from Tampermonkey menu.');
  }

  // =========================================================================
  // 5. Modal UI
  // =========================================================================

  let modalEl = null;

  function injectStyles() {
    log('ui', 'Injecting modal stylesheet.');
    GM_addStyle(`
      .bsnz-bgg-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center;
        z-index: 2147483600; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .bsnz-bgg-modal {
        background: #fff; color: #222; border-radius: 10px;
        padding: 22px 26px; width: 460px; max-width: calc(100vw - 32px);
        box-shadow: 0 20px 60px rgba(0,0,0,0.45);
      }
      .bsnz-bgg-modal h2 { margin: 0 0 4px; font-size: 18px; color: #2c3e50; }
      .bsnz-bgg-modal .ver { font-size: 11px; color: #95a5a6; margin-left: 6px; font-weight: 400; }
      .bsnz-bgg-modal p { margin: 0 0 14px; font-size: 13px; color: #555; line-height: 1.45; }
      .bsnz-bgg-modal label {
        display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 12px 0;
      }
      .bsnz-bgg-modal input[type="number"] {
        width: 110px; padding: 6px 8px; font: inherit;
        border: 1px solid #bdc3c7; border-radius: 4px;
      }
      .bsnz-bgg-actions {
        display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;
      }
      .bsnz-bgg-actions button {
        padding: 8px 16px; border-radius: 5px; border: 1px solid #95a5a6;
        background: #fff; color: #222; font: inherit; cursor: pointer;
      }
      .bsnz-bgg-actions button.primary {
        background: #2980b9; color: #fff; border-color: #2980b9;
      }
      .bsnz-bgg-actions button.primary:hover:not(:disabled) { background: #246993; }
      .bsnz-bgg-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
      .bsnz-bgg-status {
        margin-top: 14px; padding: 10px 12px; border-radius: 6px;
        font-size: 13px; line-height: 1.4; min-height: 18px;
        background: #ecf0f1; color: #2c3e50;
      }
      .bsnz-bgg-status.error   { background: #fdecea; color: #922b21; }
      .bsnz-bgg-status.success { background: #e7f6ec; color: #1d6e3a; }
      .bsnz-bgg-hint {
        margin-top: 8px; font-size: 11px; color: #7f8c8d; line-height: 1.4;
      }
    `);
  }

  function openModal() {
    if (modalEl) {
      log('ui', 'Modal already exists — re-showing.');
      modalEl.style.display = 'flex';
      return;
    }
    log('ui', 'Building modal for the first time.');
    injectStyles();

    modalEl = document.createElement('div');
    modalEl.className = 'bsnz-bgg-backdrop';
    modalEl.innerHTML = `
      <div class="bsnz-bgg-modal" role="dialog" aria-labelledby="bsnz-bgg-h">
        <h2 id="bsnz-bgg-h">${SCRIPT_NAME} <span class="ver">v${VERSION}</span></h2>
        <p>Downloads BGG's daily ranks dump, filters to the top-N by rank, and writes
           <code>${OUTPUT_FILENAME}</code> for Board Scout NZ. You must be signed
           in to BGG in this browser.</p>
        <label>
          Export top
          <input type="number" id="bsnz-bgg-max" value="${DEFAULT_MAX}" min="1" max="200000" />
          ranked games
        </label>
        <div class="bsnz-bgg-actions">
          <button id="bsnz-bgg-close">Close</button>
          <button id="bsnz-bgg-go" class="primary">Download &amp; Process</button>
        </div>
        <div class="bsnz-bgg-status" id="bsnz-bgg-status">Ready.</div>
        <div class="bsnz-bgg-hint">Open DevTools (F12 → Console) for verbose progress and error diagnostics — filter for <code>[bsnz-bgg]</code>.</div>
      </div>`;
    document.body.appendChild(modalEl);

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      log('ui', `Restoring last-used max-rank from storage: ${stored}`);
      document.getElementById('bsnz-bgg-max').value = stored;
    }

    document.getElementById('bsnz-bgg-close').addEventListener('click', () => {
      log('ui', 'Close button clicked.');
      modalEl.style.display = 'none';
    });
    document.getElementById('bsnz-bgg-go').addEventListener('click', () => {
      log('ui', 'Download & Process button clicked.');
      startExport();
    });
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) {
        log('ui', 'Modal backdrop clicked → closing.');
        modalEl.style.display = 'none';
      }
    });
    log('ui', 'Modal built and event handlers wired.');
  }

  function setStatus(msg, kind = 'info') {
    const el = document.getElementById('bsnz-bgg-status');
    if (el) { el.textContent = msg; el.className = `bsnz-bgg-status ${kind}`; }
    log('status', `[${kind}] ${msg}`);
  }
  function setBusy(busy) {
    log('ui', `setBusy(${busy})`);
    const btn = document.getElementById('bsnz-bgg-go');
    if (btn) btn.disabled = busy;
  }

  // =========================================================================
  // 6. Main pipeline — every step runs inside its own console group so the
  //    log can be collapsed/expanded by stage.
  // =========================================================================

  async function startExport() {
    grp('export', '=== Starting export pipeline ===');
    const totalT = startTimer();
    const summary = {};
    setBusy(true);

    try {
      const maxRank = validateInput();
      summary.maxRank = maxRank;

      const zipUrl = await findZipUrl();
      summary.zipUrl = zipUrl;

      const zipBuffer = await fetchArrayBuffer(zipUrl);
      summary.downloadBytes = zipBuffer.byteLength;

      validateZipBuffer(zipBuffer);

      const decompressed = await decompressZip(zipBuffer);
      summary.archiveFiles = Object.keys(decompressed);

      const csvText = extractCsvText(decompressed);
      summary.csvChars = csvText.length;

      const rows = parseCsv(csvText);
      summary.parsedRows = rows.length;

      const out = filterAndShape(rows, maxRank);
      summary.outputRows = out.length;

      const json = buildJson(out);
      summary.jsonChars = json.length;
      downloadFile(OUTPUT_FILENAME, 'application/json', json);

      // Also emit a small fixed-size example file alongside the full one
      // — purely a structural reference for downstream debugging when the
      // full file is too large to share. Always the top-N by rank.
      grp('export', `Building example file (top ${SAMPLE_SIZE} entries)`);
      const sample = out.slice(0, SAMPLE_SIZE);
      const sampleJson = buildJson(sample);
      summary.sampleRows = sample.length;
      summary.sampleJsonChars = sampleJson.length;
      log('export', `Example: ${sample.length} entries, ${sampleJson.length.toLocaleString()} chars`);
      grpEnd();

      // Brief gap so Chrome doesn't merge or block the second download.
      await new Promise((r) => setTimeout(r, 500));
      downloadFile(SAMPLE_OUTPUT_FILENAME, 'application/json', sampleJson);

      summary.totalTime = totalT();
      log('export', '=== Export pipeline finished SUCCESSFULLY ===', summary);

      setStatus(
        `✅ Done in ${summary.totalTime}. Saved ${out.length.toLocaleString()} games to ` +
        `${OUTPUT_FILENAME} (~${(json.length / 1024).toFixed(0)} KB) and ` +
        `${sample.length} games to ${SAMPLE_OUTPUT_FILENAME}. ` +
        `Drop both into your repo's data/ folder.`,
        'success',
      );
    } catch (e) {
      summary.totalTime = totalT();
      err('export', '=== Export pipeline FAILED ===', { error: e.message, stack: e.stack, summary });
      setStatus(`Failed after ${summary.totalTime}: ${e.message}`, 'error');
    } finally {
      setBusy(false);
      grpEnd();
    }
  }

  // ---- step 1: read & validate user input -------------------------------

  function validateInput() {
    grp('input', 'Reading & validating max-rank from modal');
    const inputEl = document.getElementById('bsnz-bgg-max');
    const raw = inputEl ? inputEl.value : '';
    log('input', `Raw input value from #bsnz-bgg-max: "${raw}"`);
    const maxRank = parseInt(raw, 10);
    if (!Number.isFinite(maxRank) || maxRank < 1) {
      grpEnd();
      throw new Error(`Invalid max-rank "${raw}" — must be a positive integer.`);
    }
    log('input', `Parsed max-rank: ${maxRank.toLocaleString()}`);
    localStorage.setItem(STORAGE_KEY, String(maxRank));
    log('input', 'Saved max-rank to localStorage for next session.');
    grpEnd();
    return maxRank;
  }

  // ---- step 2: find ZIP URL on data_dumps page --------------------------

  function findZipUrl() {
    return new Promise((resolve, reject) => {
      grp('fetch', `Step 2: GET ${RANKS_PAGE_URL}`);
      setStatus('Fetching BGG data dumps page…');
      const t = startTimer();

      GM_xmlhttpRequest({
        method: 'GET',
        url: RANKS_PAGE_URL,
        onload: (res) => {
          log('fetch', `Index response: status=${res.status}, finalURL=${res.finalUrl || '(none)'}, time=${t()}`);
          if (res.responseHeaders) {
            log('fetch', `Response headers (first 10 lines):\n${res.responseHeaders.split('\n').slice(0, 10).join('\n')}`);
          }
          if (res.status === 401 || res.status === 403) {
            grpEnd();
            reject(new Error(`HTTP ${res.status} — you need to be signed in to BGG to access the ranks dump.`));
            return;
          }
          if (res.status !== 200) {
            grpEnd();
            reject(new Error(`HTTP ${res.status} fetching ranks page`));
            return;
          }
          const html = res.responseText || '';
          log('fetch', `Index page HTML received: ${html.length.toLocaleString()} chars`);

          const m = html.match(/href\s*=\s*["']([^"']+\.zip[^"']*)["']/i);
          if (!m) {
            log('fetch', 'No .zip link found. First 1000 chars of page:\n', html.slice(0, 1000));
            grpEnd();
            reject(new Error('No .zip link on data_dumps page — are you signed in to BGG?'));
            return;
          }
          let url = m[1].replace(/&amp;/g, '&');
          if (url.startsWith('//')) url = 'https:' + url;
          else if (url.startsWith('/')) url = 'https://boardgamegeek.com' + url;
          log('fetch', `Extracted ZIP URL: ${url}`);
          grpEnd();
          resolve(url);
        },
        onerror: (e) => {
          err('fetch', 'Network error fetching ranks page.', e);
          grpEnd();
          reject(new Error('Network error fetching the ranks page'));
        },
        ontimeout: () => {
          err('fetch', 'Timeout fetching ranks page.');
          grpEnd();
          reject(new Error('Timeout fetching the ranks page'));
        },
        timeout: 30_000,
      });
    });
  }

  // ---- step 3: download the ZIP ----------------------------------------

  function fetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      grp('fetch', `Step 3: GET ${url} (responseType=arraybuffer)`);
      setStatus(`Downloading ZIP from ${new URL(url).hostname}…`);
      const t = startTimer();

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        onprogress: (p) => {
          if (p && p.loaded) {
            const loadedMB = (p.loaded / 1024 / 1024).toFixed(2);
            const totalMB  = p.total ? ` / ${(p.total / 1024 / 1024).toFixed(2)} MB` : '';
            log('fetch', `…progress: ${loadedMB} MB${totalMB}`);
          }
        },
        onload: (res) => {
          log('fetch', `ZIP fetch returned: status=${res.status}, time=${t()}`);
          if (res.status !== 200) {
            grpEnd();
            reject(new Error(`HTTP ${res.status} downloading ZIP from ${url}`));
            return;
          }
          if (!res.response) {
            grpEnd();
            reject(new Error('Empty response body — Tampermonkey may not be returning ArrayBuffer here.'));
            return;
          }
          const ab = res.response;
          const sizeMB = (ab.byteLength / 1024 / 1024).toFixed(2);
          log('fetch', `ZIP buffer received: ${ab.byteLength.toLocaleString()} bytes (${sizeMB} MB), constructor=${ab.constructor && ab.constructor.name}`);
          setStatus(`Downloaded ${sizeMB} MB.`);
          grpEnd();
          resolve(ab);
        },
        onerror: (e) => { err('fetch', 'Network error downloading ZIP.', e); grpEnd(); reject(new Error('Network error downloading ZIP')); },
        ontimeout: () => { err('fetch', 'Timeout downloading ZIP.'); grpEnd(); reject(new Error('Timeout downloading ZIP')); },
        timeout: 180_000,
      });
    });
  }

  // ---- step 4: validate the buffer is a real ZIP -----------------------

  function validateZipBuffer(arrayBuffer) {
    grp('zip-validate', 'Step 4: validating ZIP buffer');
    log('zip-validate', `Buffer byteLength: ${arrayBuffer.byteLength.toLocaleString()}`);
    if (arrayBuffer.byteLength < 22) {
      grpEnd();
      throw new Error(`Buffer too small to be a ZIP (${arrayBuffer.byteLength} bytes; min 22).`);
    }
    const head = new Uint8Array(arrayBuffer.slice(0, 4));
    const hex = Array.from(head).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const headText = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer.slice(0, 200));
    log('zip-validate', `First 4 bytes (hex): ${hex}`);
    log('zip-validate', `First 200 chars as text: ${JSON.stringify(headText)}`);
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      grpEnd();
      throw new Error(
        `Buffer is not a ZIP (first bytes "${hex}"). ` +
        `Likely BGG returned an HTML page instead. See console for the first 200 chars.`,
      );
    }
    log('zip-validate', '✅ ZIP signature OK (PK\\x03\\x04).');
    grpEnd();
  }

  // ---- step 5: decompress with fflate (pure-JS, synchronous) -----------

  function decompressZip(arrayBuffer) {
    return new Promise((resolve, reject) => {
      grp('unzip', 'Step 5: decompressing ZIP with fflate.unzipSync');
      setStatus('Decompressing ZIP archive…');

      if (typeof fflate === 'undefined' || typeof fflate.unzipSync !== 'function') {
        grpEnd();
        reject(new Error('fflate not available — the @require URL may be blocked. Check the network tab.'));
        return;
      }
      log('unzip', 'fflate.unzipSync available; preparing input view.');

      const u8 = new Uint8Array(arrayBuffer);
      log('unzip', `Input bytes: ${u8.length.toLocaleString()}`);

      // Yield once so the modal repaints "Decompressing…" before we spend
      // a CPU burst on potentially-large data.
      setTimeout(() => {
        const t = startTimer();
        try {
          log('unzip', 'Calling fflate.unzipSync …');
          const decompressed = fflate.unzipSync(u8);
          log('unzip', `fflate.unzipSync completed in ${t()}.`);

          const fileNames = Object.keys(decompressed);
          log('unzip', `Archive contains ${fileNames.length} file(s):`,
            fileNames.map((n) => ({ name: n, bytes: decompressed[n].length })));

          if (!fileNames.length) {
            grpEnd();
            reject(new Error('ZIP archive contained no files.'));
            return;
          }
          grpEnd();
          resolve(decompressed);
        } catch (e) {
          err('unzip', 'fflate.unzipSync threw:', e);
          grpEnd();
          reject(new Error(`Decompression failed: ${e.message}`));
        }
      }, 50);
    });
  }

  // ---- step 6: pick the CSV file & decode as UTF-8 ---------------------

  function extractCsvText(decompressed) {
    grp('csv-extract', 'Step 6: extracting CSV text');
    const fileNames = Object.keys(decompressed);
    log('csv-extract', `Looking for *.csv among: ${fileNames.join(', ')}`);
    const csvName = fileNames.find((n) => /\.csv$/i.test(n));
    if (!csvName) {
      grpEnd();
      throw new Error(`No .csv inside ZIP. Files found: ${fileNames.join(', ') || '(none)'}`);
    }
    const bytes = decompressed[csvName];
    log('csv-extract', `Selected: ${csvName} (${bytes.length.toLocaleString()} bytes)`);
    setStatus(`Decoding ${csvName}…`);

    const t = startTimer();
    let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    log('csv-extract', `Decoded ${text.length.toLocaleString()} chars in ${t()}.`);

    if (text.charCodeAt(0) === 0xFEFF) {
      log('csv-extract', 'Stripping UTF-8 BOM at offset 0.');
      text = text.slice(1);
    }
    log('csv-extract', `First 200 chars:\n${text.slice(0, 200)}`);
    log('csv-extract', `Last 200 chars:\n${text.slice(-200)}`);
    grpEnd();
    return text;
  }

  // ---- step 7: parse CSV -----------------------------------------------

  function parseCsv(text) {
    grp('csv-parse', 'Step 7: parsing CSV (RFC-4180-ish)');
    setStatus('Parsing CSV…');
    const t = startTimer();

    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"')       inQuotes = true;
        else if (ch === ',')  { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* skip */ }
        else                   field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    log('csv-parse', `Tokenised ${rows.length.toLocaleString()} rows (incl. header) in ${t()}.`);
    if (!rows.length) { grpEnd(); throw new Error('CSV had no rows.'); }

    const headers = rows[0].map((h) => h.trim().toLowerCase());
    log('csv-parse', `Headers (${headers.length}):`, headers);

    const cols = {
      id:      headers.indexOf('id'),
      name:    headers.indexOf('name'),
      rank:    headers.indexOf('rank'),
      average: headers.indexOf('average'),
    };
    log('csv-parse', 'Resolved column indexes:', cols);
    if (cols.id < 0 || cols.name < 0 || cols.rank < 0 || cols.average < 0) {
      grpEnd();
      throw new Error(`CSV missing required columns. Found: ${headers.join(', ')}`);
    }

    const out = [];
    let skippedShort = 0, skippedUnranked = 0;
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells || cells.length < headers.length / 2) { skippedShort++; continue; }
      const rank = parseInt(cells[cols.rank], 10);
      if (!Number.isFinite(rank)) { skippedUnranked++; continue; }
      out.push({
        id:      parseInt(cells[cols.id], 10),
        name:    cells[cols.name],
        rank,
        average: parseFloat(cells[cols.average]),
      });
    }
    log('csv-parse',
      `Parsed ${out.length.toLocaleString()} usable rows ` +
      `(${skippedShort.toLocaleString()} short rows skipped, ${skippedUnranked.toLocaleString()} unranked skipped) in ${t()}.`);
    if (out.length) log('csv-parse', 'Sample — first 3 rows:', out.slice(0, 3));
    grpEnd();
    return out;
  }

  // ---- step 8: filter to top-N + reshape to cache schema ---------------

  function filterAndShape(rows, maxRank) {
    grp('filter', `Step 8: filter & shape — keep ranks ≤ ${maxRank.toLocaleString()}`);
    setStatus(`Filtering to top ${maxRank.toLocaleString()}…`);
    const t = startTimer();

    const kept = rows.filter((r) =>
      Number.isFinite(r.id) &&
      Number.isFinite(r.rank) && r.rank > 0 && r.rank <= maxRank &&
      r.name);
    log('filter', `Filtered: ${rows.length.toLocaleString()} → ${kept.length.toLocaleString()} in ${t()}.`);

    const shaped = kept
      .map((r) => ({
        id:          r.id,
        primaryName: r.name,
        rank:        r.rank,
        average:     Number.isFinite(r.average) ? Number(r.average.toFixed(3)) : null,
      }))
      .sort((a, b) => a.rank - b.rank);

    if (!shaped.length) {
      grpEnd();
      throw new Error('No rows passed the rank filter — check that your max-rank value is sensible.');
    }
    log('filter', 'Sample — first 3 shaped rows:', shaped.slice(0, 3));
    log('filter', 'Sample — last 3 shaped rows:',  shaped.slice(-3));
    log('filter', `Rank range in output: ${shaped[0].rank} – ${shaped[shaped.length - 1].rank}`);
    grpEnd();
    return shaped;
  }

  // ---- step 9: serialise to JSON ---------------------------------------

  function buildJson(rows) {
    grp('json', 'Step 9: serialising to JSON (one game per line)');
    setStatus('Building JSON…');
    const t = startTimer();
    const body = '[\n' + rows.map((g) => '  ' + JSON.stringify(g)).join(',\n') + '\n]\n';
    log('json', `JSON body built: ${body.length.toLocaleString()} chars in ${t()}.`);
    log('json', `First 300 chars:\n${body.slice(0, 300)}`);
    grpEnd();
    return body;
  }

  // ---- step 10: trigger the browser download ---------------------------

  function downloadFile(filename, mime, content) {
    grp('download', `Step 10: triggering browser download "${filename}"`);
    log('download', `mime=${mime}, size=${content.length.toLocaleString()} chars`);
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url); a.remove();
        log('download', 'Cleaned up Blob URL and anchor element.');
      }, 1000);
      log('download', `Download click dispatched for "${filename}".`);
    } catch (e) {
      err('download', 'Download trigger threw.', e);
      grpEnd();
      throw e;
    }
    grpEnd();
  }
})();