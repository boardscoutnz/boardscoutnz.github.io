// tprmky/bsnz-pipeline-src/01b-run-history.js
// Persistent run history. Each Run-pipeline invocation produces one record
// (start/end timestamps, duration, crawl speed, outcome, per-phase timings)
// stored under RUN_HISTORY_KEY via GM_setValue. Survives "Clear all data" —
// see clearAllConfig() in 00-config.js, which explicitly skips the key. Runs
// inside the shared IIFE opened in 00-config.js — references VERSION, BSNZ,
// log, RUN_HISTORY_KEY, RUN_HISTORY_MAX_ENTRIES, crawlSpeedLabelForMultiplier
// from closure scope. The Run handler in 01-ui.js calls runHistoryStart() /
// runHistoryFinish(); 02-tm-scraper.js and 03-bgg-corpus.js bracket each
// phase with runHistoryStartPhase() / runHistoryEndPhase().

  // --- Persistence ----------------------------------------------------------
  function loadRunHistory() {
    const raw = GM_getValue(RUN_HISTORY_KEY, null);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    // Tolerate older string-encoded values just in case.
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  function saveRunHistory(arr) {
    const trimmed = (arr || []).slice(0, RUN_HISTORY_MAX_ENTRIES);
    GM_setValue(RUN_HISTORY_KEY, trimmed);
  }
  function clearRunHistory() {
    GM_setValue(RUN_HISTORY_KEY, []);
  }

  // --- Current-run accumulator ---------------------------------------------
  let currentRun = null;

  function runHistoryStart() {
    const mult = (BSNZ.config && BSNZ.config.pacing_multiplier) || 1.0;
    currentRun = {
      id: 'run_' + Date.now(),
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      outcome: null,
      error: null,
      crawl_speed: crawlSpeedLabelForMultiplier(mult),
      crawl_speed_multiplier: mult,
      phases: [],
      stats: null
    };
  }

  function runHistoryStartPhase(name) {
    if (!currentRun) return;
    currentRun.phases.push({
      name,
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null
    });
  }

  function runHistoryEndPhase(name, extraStats) {
    if (!currentRun) return;
    // Find the most recent open phase entry with this name (handles repeats).
    for (let i = currentRun.phases.length - 1; i >= 0; i--) {
      const p = currentRun.phases[i];
      if (p.name === name && !p.completed_at) {
        p.completed_at = new Date().toISOString();
        p.duration_ms = new Date(p.completed_at) - new Date(p.started_at);
        if (extraStats && typeof extraStats === 'object') {
          Object.assign(p, extraStats);
        }
        return;
      }
    }
  }

  function runHistoryFinish(outcome, errorMessage) {
    if (!currentRun) return; // idempotent
    currentRun.completed_at = new Date().toISOString();
    currentRun.duration_ms =
      new Date(currentRun.completed_at) - new Date(currentRun.started_at);
    currentRun.outcome = outcome || 'success';
    if (errorMessage) currentRun.error = String(errorMessage);
    // Snapshot stats so the modal can show e.g. tm_scraped/bgg_searched.
    try { currentRun.stats = JSON.parse(JSON.stringify(BSNZ.stats || {})); }
    catch (_) { currentRun.stats = null; }

    const history = loadRunHistory();
    history.unshift(currentRun);
    saveRunHistory(history);
    currentRun = null;
  }

  // --- Modal renderer -------------------------------------------------------
  let runHistoryOverlay = null;

  function fmtDuration(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return '—';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  function fmtStartedAt(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, '0');
      const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return { time, date };
    } catch (_) {
      return { time: iso, date: '' };
    }
  }
  function outcomeColour(outcome) {
    if (outcome === 'success')   return '#1e8449';
    if (outcome === 'error')     return '#c0392b';
    if (outcome === 'cancelled') return '#7f8c8d';
    return '#555';
  }

  function buildPhaseDetails(phases) {
    const details = el('details', null);
    const summary = el('summary', { cursor: 'pointer', userSelect: 'none' },
      { text: `${(phases || []).length} phase${phases && phases.length === 1 ? '' : 's'}` });
    details.append(summary);
    if (!phases || phases.length === 0) return details;
    const list = el('div', { marginTop: '4px', paddingLeft: '8px',
      borderLeft: '2px solid #444', fontSize: '11px' });
    for (const p of phases) {
      const row = el('div', { marginBottom: '4px' });
      const dur = p.duration_ms != null
        ? fmtDuration(p.duration_ms)
        : (p.completed_at ? '—' : '(interrupted)');
      const head = el('div', { fontWeight: '600' },
        { text: `${p.name} — ${dur}` });
      row.append(head);
      // Surface known extra-stat keys; skip the timestamp/duration scaffolding.
      const skip = new Set(['name', 'started_at', 'completed_at', 'duration_ms']);
      const extras = [];
      for (const k of Object.keys(p)) {
        if (skip.has(k)) continue;
        extras.push(`${k}=${JSON.stringify(p[k])}`);
      }
      if (extras.length) {
        row.append(el('div', { color: '#bbb' }, { text: extras.join(', ') }));
      }
      list.append(row);
    }
    details.append(list);
    return details;
  }

  function runHistoryRenderModal() {
    // Idempotent: re-clicking History while open is a no-op.
    if (runHistoryOverlay) return runHistoryOverlay;

    const overlay = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.55)', zIndex: '100001',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const dialog = el('div', {
      width: '640px', maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto',
      background: '#1f2024', color: '#e6e6e6',
      border: '1px solid #444', borderRadius: '6px',
      padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      display: 'flex', flexDirection: 'column', gap: '10px'
    });

    function close() {
      if (!runHistoryOverlay) return;
      runHistoryOverlay.remove();
      runHistoryOverlay = null;
    }

    const titleRow = el('div', { display: 'flex', alignItems: 'center' });
    titleRow.append(
      el('span', { flex: '1', fontWeight: '700', fontSize: '15px' },
        { text: 'Run history' }),
      el('button', {
        background: 'transparent', border: 'none', color: '#e6e6e6',
        cursor: 'pointer', fontSize: '18px', padding: '0 4px'
      }, { text: '×', title: 'Close', on: { click: close } })
    );
    dialog.append(titleRow);

    const history = loadRunHistory();
    if (history.length === 0) {
      dialog.append(el('div', { color: '#aaa', padding: '20px 0' },
        { text: 'No runs recorded yet.' }));
    } else {
      const table = el('table', {
        width: '100%', borderCollapse: 'collapse', fontSize: '12px'
      });
      const thead = el('thead', null);
      const headerTr = el('tr', null);
      for (const h of ['Started', 'Speed', 'Duration', 'Outcome', 'Phases']) {
        headerTr.append(el('th', {
          textAlign: 'left', padding: '6px 8px',
          borderBottom: '1px solid #444', color: '#bbb', fontWeight: '600'
        }, { text: h }));
      }
      thead.append(headerTr);
      table.append(thead);

      const tbody = el('tbody', null);
      for (const run of history) {
        const tr = el('tr', { borderBottom: '1px solid #2c2d31' });
        const started = fmtStartedAt(run.started_at);
        const startedCell = el('td', { padding: '6px 8px', verticalAlign: 'top' });
        startedCell.append(
          el('div', { fontFamily: 'ui-monospace, monospace' }, { text: started.time || '—' }),
          el('div', { fontSize: '10px', color: '#888' }, { text: started.date || '' })
        );
        const speedCell = el('td', { padding: '6px 8px', verticalAlign: 'top' },
          { text: run.crawl_speed || '—' });
        const durCell = el('td', {
          padding: '6px 8px', verticalAlign: 'top',
          fontFamily: 'ui-monospace, monospace'
        }, { text: fmtDuration(run.duration_ms) });
        const outcomeCell = el('td', {
          padding: '6px 8px', verticalAlign: 'top',
          color: outcomeColour(run.outcome), fontWeight: '600'
        }, { text: run.outcome || '—' });
        if (run.error) outcomeCell.title = run.error;
        const phasesCell = el('td', { padding: '6px 8px', verticalAlign: 'top' });
        phasesCell.append(buildPhaseDetails(run.phases));

        tr.append(startedCell, speedCell, durCell, outcomeCell, phasesCell);
        tbody.append(tr);
      }
      table.append(tbody);
      dialog.append(table);
    }

    const footer = el('div', {
      display: 'flex', justifyContent: 'flex-end', gap: '8px',
      borderTop: '1px solid #444', paddingTop: '10px', marginTop: '4px'
    });
    const clearBtn = el('button', {
      padding: '6px 10px', background: '#c0392b', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Clear history', on: { click: () => {
      if (!confirm('Clear all run history? This cannot be undone.')) return;
      clearRunHistory();
      log('warn', 'Run history cleared.');
      // Re-render in place: close + reopen.
      close();
      runHistoryRenderModal();
    } } });
    const closeBtn = el('button', {
      padding: '6px 10px', background: '#444', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Close', on: { click: close } });
    footer.append(clearBtn, closeBtn);
    dialog.append(footer);

    overlay.append(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    runHistoryOverlay = overlay;
    return overlay;
  }
