  // ============================================================================
  // 16. MINIMAL UI — Shadow DOM, just status + 4 buttons
  // ============================================================================

  let uiHost = null;
  let uiShadow = null;

  const UI_CSS = `
    :host { all: initial; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #fab {
      position: fixed; right: 16px; bottom: 16px;
      width: 52px; height: 52px; border-radius: 26px;
      background: #c0392b; color: #fff; border: 2px solid #fff; cursor: pointer;
      font-size: 22px; box-shadow: 0 2px 12px rgba(0,0,0,.4);
      z-index: 2147483647;
    }
    #fab:hover { background: #a83228; }
    #fab.flash { animation: bgbf-flash 1.2s ease-out 2; }
    @keyframes bgbf-flash {
      0% { transform: scale(1); }
      50% { transform: scale(1.2); box-shadow: 0 0 0 12px rgba(192,57,43,.3); }
      100% { transform: scale(1); }
    }
    #toast {
      position: fixed; right: 16px; top: 16px;
      background: #27ae60; color: #fff; padding: 10px 14px;
      border-radius: 6px; font-size: 13px; font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); z-index: 2147483647;
      animation: bgbf-toast 4s ease-out forwards;
    }
    @keyframes bgbf-toast {
      0% { transform: translateY(-20px); opacity: 0; }
      10% { transform: translateY(0); opacity: 1; }
      85% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-20px); opacity: 0; }
    }
    #panel {
      position: fixed; right: 16px; bottom: 76px;
      width: 320px; max-height: 80vh; overflow: auto;
      background: #fff; color: #222; border: 1px solid #ddd; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
      padding: 12px; font-size: 13px;
    }
    #panel header { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    #panel header strong { font-size: 14px; }
    #panel-version { font-size: 11px; color: #888; }
    #panel-close { margin-left: auto; background: none; border: none; font-size: 20px; cursor: pointer; color: #666; }
    #status { background: #fafafa; padding: 8px; border-radius: 6px; margin-bottom: 10px; }
    .kv { display: flex; justify-content: space-between; padding: 2px 0; }
    .kv span:first-child { color: #666; }
    #run-bar { margin-top: 8px; }
    #run-msg { font-size: 12px; color: #444; margin-bottom: 4px; min-height: 1.2em; }
    #run-progress { width: 100%; }
    #actions, #actions2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    #options { display: flex; align-items: center; gap: 6px; padding: 6px 4px; margin-bottom: 6px; font-size: 12px; }
    #options label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
    .btn { padding: 8px 10px; border: 1px solid #ccc; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .btn:hover { background: #f5f5f5; }
    .btn.primary { background: #2980b9; color: #fff; border-color: #2980b9; }
    .btn.primary:hover { background: #246993; }
    .btn.danger { background: #e74c3c; color: #fff; border-color: #e74c3c; }
    .btn.danger:hover { background: #c0392b; }
    .btn.warn { background: #f39c12; color: #fff; border-color: #f39c12; }
    .btn-with-info { display: flex; align-items: center; gap: 6px; }
    .btn-with-info .btn { flex: 1; }
    .info-tip {
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 16px; flex: 0 0 16px;
      border-radius: 50%; background: #95a5a6; color: #fff;
      font-size: 10px; font-weight: 700; cursor: help;
      user-select: none; line-height: 1;
    }
    .info-tip:hover { background: #7f8c8d; }
    /* Tooltip is a real element rendered at the shadow-root level, OUTSIDE
       #panel, so it is not clipped by the panel's overflow:auto. Positioned
       at runtime by setupInfoTips() using getBoundingClientRect on the
       trigger \`?\` icon. */
    .floating-tip {
      position: fixed;
      left: -9999px; top: -9999px;
      background: #1a242f; color: #ecf0f1;
      padding: 6px 8px; border-radius: 4px;
      font-size: 11px; line-height: 1.35;
      white-space: normal; width: max-content; max-width: 240px;
      box-shadow: 0 4px 12px rgba(0,0,0,.35);
      pointer-events: none;
      opacity: 0; visibility: hidden;
      transition: opacity .12s;
      z-index: 2147483647;
    }
    .floating-tip.visible { opacity: 1; visibility: visible; }
    footer { font-size: 10px; color: #888; text-align: center; margin-top: 6px; }
  `;

  function ensureUI() {
    if (uiShadow) return uiShadow;
    uiHost = document.createElement('div');
    uiHost.id = 'tm-bgbf-host';
    uiHost.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    document.documentElement.appendChild(uiHost);
    uiShadow = uiHost.attachShadow({ mode: 'open' });
    uiShadow.innerHTML = `
      <style>${UI_CSS}</style>
      <div id="root">
        <div id="toast">✅ Board Games Bulk Fetcher Collector loaded (v${VERSION})</div>
        <button id="fab" class="flash" title="Board Games Bulk Fetcher (Collector)">🎲</button>
        <div id="panel" hidden>
          <header>
            <strong>Board Games Collector</strong>
            <span id="panel-version">v${VERSION}</span>
            <button id="panel-close" title="Close">×</button>
          </header>
          <section id="status">
            <div class="kv"><span>Listings stored:</span><span id="kv-listings">…</span></div>
            <div class="kv"><span>Last fetch:</span><span id="kv-last-fetch">never</span></div>
            <div class="kv"><span>Last export:</span><span id="kv-last-export">never</span></div>
            <div id="run-bar" hidden>
              <div id="run-msg">…</div>
              <progress id="run-progress" max="100" value="0"></progress>
              <button id="run-abort" class="btn warn">Abort</button>
            </div>
          </section>
          <section id="actions">
            <span class="btn-with-info">
              <button id="act-incremental" class="btn primary">Quick run</button>
              <span class="info-tip" data-tip="Fetches only listings new since the last run. Fast incremental update — typically under a minute. Auto-exports listings.json at the end.">?</span>
            </span>
            <span class="btn-with-info">
              <button id="act-full" class="btn">Run full fetch</button>
              <span class="info-tip" data-tip="Walks every category from page 1, refreshing all listings. Slow — 10–30 minutes. Use after schema changes or to seed a fresh database.">?</span>
            </span>
          </section>
          <section id="actions2">
            <span class="btn-with-info">
              <button id="act-export" class="btn">Export JSON now</button>
              <span class="info-tip" data-tip="Exports the current IndexedDB contents as listings.json without running a fetch first. Useful for re-exporting unchanged data.">?</span>
            </span>
            <span class="btn-with-info">
              <button id="act-clear" class="btn danger">Clear all data…</button>
              <span class="info-tip" data-tip="Wipes the entire local IndexedDB. Cannot be undone. The next run will start from a blank corpus.">?</span>
            </span>
          </section>
          <section id="options">
            <label>
              <input type="checkbox" id="opt-export-sample" />
              Also export listings-example.json (sample)
            </label>
            <span class="info-tip" data-tip="When ticked, also auto-downloads listings-example.json (a 160-row balanced sample) at the end of every run. Useful for sharing the schema without dumping the whole corpus.">?</span>
          </section>
          <footer>
            JSON auto-downloads at end of every run. Drop into the static web app to browse.
          </footer>
        </div>
        <div id="floating-tip" class="floating-tip" role="tooltip"></div>
      </div>
    `;
    wirePanel();
    setupInfoTips();
    const toast = uiShadow.getElementById('toast');
    if (toast) setTimeout(() => { try { toast.remove(); } catch {} }, 4500);
    const fab = uiShadow.getElementById('fab');
    if (fab) setTimeout(() => fab.classList.remove('flash'), 3000);
    return uiShadow;
  }

  function $(sel) { return uiShadow.querySelector(sel); }

  function wirePanel() {
    $('#fab').addEventListener('click', () => {
      const p = $('#panel'); p.hidden = !p.hidden;
      if (!p.hidden) { refreshPanelStatus(); hydrateExportSampleCheckbox(); }
    });
    const exportSampleEl = $('#opt-export-sample');
    if (exportSampleEl) {
      exportSampleEl.addEventListener('change', () => {
        try { GM_setValue(GM_KEY_EXPORT_SAMPLE, !!exportSampleEl.checked); }
        catch (e) { warn('persist exportSampleEnabled failed', e); }
      });
    }
    $('#panel-close').addEventListener('click', () => { $('#panel').hidden = true; });
    $('#act-full').addEventListener('click', () => runFullFetch());
    $('#act-incremental').addEventListener('click', () => runIncrementalFetch());
    $('#act-export').addEventListener('click', () => exportJsonForWebapp('manual'));
    $('#act-clear').addEventListener('click', async () => {
      if (!confirm('Wipe all stored Board Games data? This cannot be undone.')) return;
      await dbDestroy(); await refreshPanelStatus();
      alert('All data cleared.');
    });
    $('#run-abort').addEventListener('click', abortRun);
    onRun(updateRunBar);
    refreshPanelStatus();
  }

  /**
   * Wire hover-tooltips for every `.info-tip` (`?`) element in the panel.
   *
   * Why this is JS-driven rather than a pure-CSS `:hover::after` trick:
   * #panel has `overflow: auto` (so long status content can scroll), and a
   * `position: absolute` tooltip nested inside #panel gets clipped at the
   * panel's edge — which is exactly what was happening in v0.7.1 (see the
   * "Quick run" / "Export JSON now" tips having their left half cut off).
   *
   * Fix: render a SINGLE shared tooltip element as a sibling of #panel
   * (i.e. outside the overflow-clipping ancestor), then on hover, position
   * it with `position: fixed` based on the trigger's bounding rect. The
   * tooltip is right-aligned to the trigger and floats above it; if there
   * is not enough space above, we flip it below; if it would overflow
   * either viewport edge horizontally, we clamp.
   */
  function setupInfoTips() {
    const tip = uiShadow.getElementById('floating-tip');
    if (!tip) return;
    const VIEWPORT_PAD = 8;        // min distance from any viewport edge
    const TRIGGER_GAP  = 8;        // gap between tooltip and trigger

    const place = (trigger) => {
      const text = trigger.getAttribute('data-tip') || '';
      if (!text) return;
      tip.textContent = text;

      // Render off-screen first so we can measure with the final text in
      // place, then move into position. This avoids a one-frame flash at
      // an old location when the tooltip is re-shown for a different
      // trigger.
      tip.style.left = '-9999px';
      tip.style.top  = '-9999px';
      tip.classList.add('visible');

      const triggerRect = trigger.getBoundingClientRect();
      const tipRect     = tip.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Default placement: above the trigger, right edge aligned with
      // trigger's right edge. (Most natural for buttons on the right
      // side of a panel.)
      let left = triggerRect.right - tipRect.width;
      let top  = triggerRect.top - tipRect.height - TRIGGER_GAP;

      // Flip below if there's no room above.
      if (top < VIEWPORT_PAD) {
        top = triggerRect.bottom + TRIGGER_GAP;
      }
      // Clamp horizontally so the tooltip never sticks off either edge.
      if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
      if (left + tipRect.width > vw - VIEWPORT_PAD) {
        left = vw - VIEWPORT_PAD - tipRect.width;
      }
      // Clamp vertically as a last resort (very tall tip on a short
      // viewport): keep at least the top edge on-screen.
      if (top + tipRect.height > vh - VIEWPORT_PAD) {
        top = Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - tipRect.height);
      }

      tip.style.left = `${Math.round(left)}px`;
      tip.style.top  = `${Math.round(top)}px`;
    };

    const hide = () => { tip.classList.remove('visible'); };

    uiShadow.querySelectorAll('.info-tip').forEach((el) => {
      el.addEventListener('mouseenter', () => place(el));
      el.addEventListener('mouseleave', hide);
      // Keyboard accessibility: focus shows, blur hides.
      el.setAttribute('tabindex', '0');
      el.addEventListener('focus', () => place(el));
      el.addEventListener('blur',  hide);
    });
  }

  // v0.7.14: read the persisted "Also export listings-example.json" toggle
  // and reflect it in the checkbox each time the panel is opened. Source of
  // truth is GM_getValue(GM_KEY_EXPORT_SAMPLE); default false.
  function hydrateExportSampleCheckbox() {
    if (!uiShadow) return;
    const cb = uiShadow.getElementById('opt-export-sample');
    if (!cb) return;
    let stored = false;
    try { stored = !!GM_getValue(GM_KEY_EXPORT_SAMPLE, false); } catch (e) { /* default false */ }
    cb.checked = stored;
  }

  // Read-only accessor used by 13-export.js to decide whether to emit
  // listings-example.json. Hits GM storage directly so it works whether or
  // not the panel has been opened this session.
  function isExportSampleEnabled() {
    try { return !!GM_getValue(GM_KEY_EXPORT_SAMPLE, false); }
    catch (e) { return false; }
  }

  async function refreshPanelStatus() {
    if (!uiShadow) return;
    try {
      const count = await dbCount(STORE_LISTINGS);
      const el = uiShadow.getElementById('kv-listings');
      if (el) el.textContent = count.toLocaleString();
      const lastFetch = await dbGet(STORE_META, 'lastFetchAt');
      const lf = uiShadow.getElementById('kv-last-fetch');
      if (lf) lf.textContent = lastFetch?.value ? new Date(lastFetch.value).toLocaleString() : 'never';
      const lastExportFromIdb = await dbGet(STORE_META, 'lastExportAt');
      let lastExportVal = lastExportFromIdb?.value;
      if (!lastExportVal) {
        try { lastExportVal = localStorage.getItem('bgbf.lastExportAt'); } catch (e) { /* ignore */ }
      }
      const le = uiShadow.getElementById('kv-last-export');
      if (le) le.textContent = lastExportVal ? new Date(lastExportVal).toLocaleString() : 'never';
    } catch (e) { warn('refreshPanelStatus failed', e); }
  }

  function updateRunBar(state) {
    if (!uiShadow) return;
    const bar = uiShadow.getElementById('run-bar');
    if (!bar) return;
    bar.hidden = !state.active && state.progress.phase !== 'complete';
    const msgEl = uiShadow.getElementById('run-msg');
    if (msgEl) msgEl.textContent = state.progress.message || '';
    let pct = 0;
    if (state.progress.totalSubcats) {
      pct = ((state.progress.doneSubcats / state.progress.totalSubcats) * 100) | 0;
      pct = clamp(pct, 0, 100);
    }
    if (state.progress.phase === 'complete') pct = 100;
    const pr = uiShadow.getElementById('run-progress');
    if (pr) pr.value = pct;
    refreshPanelStatus();
  }

