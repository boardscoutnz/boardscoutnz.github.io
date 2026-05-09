  // ============================================================================
  // 17. RUN HISTORY — persistent log of completed runs (v0.7.17)
  // ============================================================================
  //
  // Persists a rolling window of run summaries (duration, start/end
  // timestamps, type, crawl-speed preset, listings count, outcome) under
  // GM_KEY_RUN_HISTORY. The orchestrators in 11-orchestrators.js call
  // recordRunHistory() in the run-completion finally-block; the panel UI
  // in 14-ui.js calls getRunHistory() / clearRunHistory() / renderRunHistory()
  // for the "Recent runs" section.
  //
  // Cross-file binding: _runStartPresetKey is declared as a module-scope
  // `let` in 11-orchestrators.js (which loads BEFORE this file, so the
  // binding is initialised by the time recordRunHistory is invoked at
  // runtime). recordRunHistory reads it via the shared IIFE closure.

  function getRunHistory() {
    try {
      const raw = GM_getValue(GM_KEY_RUN_HISTORY, '[]');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function appendRunHistoryEntry(entry) {
    const arr = getRunHistory();
    arr.push(entry);
    while (arr.length > RUN_HISTORY_MAX) arr.shift();
    GM_setValue(GM_KEY_RUN_HISTORY, JSON.stringify(arr));
  }

  function clearRunHistory() {
    try { GM_setValue(GM_KEY_RUN_HISTORY, '[]'); } catch (e) { /* non-fatal */ }
  }

  function formatDurationLabel(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m >= 1 ? `${m}m ${s}s` : `${s}s`;
  }

  function recordRunHistory({ startedAtIso, startMs, type, outcome }) {
    try {
      const completedAtIso = nowIso();
      const durationMs = Date.now() - startMs;
      const presetKey = _runStartPresetKey || getActivePresetKey();
      const presetCfg = CRAWL_SPEED_PRESETS[presetKey] || {};
      appendRunHistoryEntry({
        startedAt: startedAtIso,
        completedAt: completedAtIso,
        type,
        durationMs,
        durationLabel: formatDurationLabel(durationMs),
        crawlSpeedPreset: presetKey,
        crawlSpeedLabel: presetCfg.label || presetKey,
        listings: runState.progress.listingsAccumulated || 0,
        outcome,
      });
    } catch (e) {
      dbg('run', 'appendRunHistoryEntry failed (non-fatal):', e && e.message);
    }
  }

  // Render the persisted run-history list (most recent first, capped at
  // 10 rows for panel space). Invoked from 14-ui.js on panel open, after
  // Clear, and on run-complete via updateRunBar(). The underlying list
  // can grow up to RUN_HISTORY_MAX in GM-storage; we just truncate the
  // visible slice.
  function renderRunHistory() {
    if (!uiShadow) return;
    const body = uiShadow.getElementById('rh-body');
    if (!body) return;
    const all = getRunHistory();
    if (!all.length) {
      body.innerHTML = '<div class="rh-empty">No runs recorded yet.</div>';
      return;
    }
    const recent = all.slice().reverse().slice(0, 10);
    const fmtWhen = (iso) => {
      try {
        const d = new Date(iso);
        const month = d.toLocaleString('en-NZ', { month: 'short' });
        const day = d.getDate();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${month} ${day}, ${hh}:${mm}`;
      } catch (e) { return iso || ''; }
    };
    const outcomeIcon = (o) => o === 'complete' ? { icon: '✓', cls: 'ok' }
                            : o === 'aborted'  ? { icon: '⚠', cls: 'warn' }
                            : { icon: '✕', cls: 'err' };
    const rows = recent.map((r) => {
      const t = r.type === 'full' ? { label: 'Full',  cls: 'full'  }
                                  : { label: 'Quick', cls: 'quick' };
      const o = outcomeIcon(r.outcome);
      const preset = escapeHtml(r.crawlSpeedLabel || r.crawlSpeedPreset || '—');
      return `<tr>
        <td class="rh-when">${escapeHtml(fmtWhen(r.startedAt))}</td>
        <td><span class="rh-type ${t.cls}">${t.label}</span></td>
        <td class="rh-dur">${escapeHtml(r.durationLabel || '')}</td>
        <td class="rh-preset">${preset}</td>
        <td class="rh-listings">${Number(r.listings || 0).toLocaleString()}</td>
        <td class="rh-outcome ${o.cls}" title="${escapeHtml(r.outcome || '')}">${o.icon}</td>
      </tr>`;
    }).join('');
    body.innerHTML = `<table>${rows}</table>`;
  }
