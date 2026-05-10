// tprmky/bsnz-pipeline-src/01a-settings.js
// Settings dialog UI extracted from 01-ui.js. Runs inside the shared IIFE
// opened in 00-config.js — references el(), log(), saveConfigKey(),
// clearAllConfig(), BSNZ, REPO_OWNER/NAME, GITHUB_API, DATA_PUBLIC_URL from
// closure scope.

  // --- Settings dialog ------------------------------------------------------
  let settingsOverlay = null;
  function openSettings() {
    if (settingsOverlay) return; // already open
    BSNZ.config = (typeof loadConfig === 'function') ? loadConfig() : BSNZ.config;
    const cfg = BSNZ.config;

    const overlay = el('div', {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.45)', zIndex: '100000',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const dialog = el('div', {
      width: '480px', maxHeight: '85vh', overflowY: 'auto',
      background: '#fff', color: '#1a1a1a', borderRadius: '6px',
      padding: '16px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      display: 'flex', flexDirection: 'column', gap: '12px'
    });

    const titleRow = el('div', { display: 'flex', alignItems: 'center' });
    titleRow.append(
      el('span', { flex: '1', fontWeight: '700', fontSize: '15px' },
        { text: 'BSNZ Pipeline settings' }),
      el('button', {
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: '18px', padding: '0 4px'
      }, { text: '×', title: 'Close', on: { click: closeSettings } })
    );

    // PAT row
    const patLabel = el('div', { fontWeight: '600' }, { text: 'GitHub Personal Access Token' });
    const patStatus = el('div', { fontSize: '11px', color: '#666' }, {
      text: cfg.pat_set_at
        ? `(set, last updated ${cfg.pat_set_at.slice(0, 10)})`
        : '(not set)'
    });
    const patInput = el('input', {
      width: '100%', padding: '6px', boxSizing: 'border-box',
      border: '1px solid #aaa', borderRadius: '4px'
    }, { type: 'password', placeholder: 'ghp_…', value: cfg.pat || '' });
    const patBtnRow = el('div', { display: 'flex', gap: '6px' });
    const savePatBtn = el('button', {
      padding: '4px 10px', background: '#3b7ddd', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Save PAT', on: { click: () => {
      const v = patInput.value.trim();
      if (!v) { log('warn', 'PAT empty — not saved.'); return; }
      saveConfigKey('gh_pat', v);
      saveConfigKey('gh_pat_set_at', new Date().toISOString());
      patStatus.textContent = `(set, last updated ${BSNZ.config.pat_set_at.slice(0, 10)})`;
      log('info', 'PAT saved.');
      refreshRunBtnEnabled();
    }}});
    const testPatBtn = el('button', {
      padding: '4px 10px', background: '#fff', color: '#333',
      border: '1px solid #aaa', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Test PAT', on: { click: () => testPat(patInput.value.trim() || cfg.pat) } });
    patBtnRow.append(savePatBtn, testPatBtn);

    // TM categories — hardcoded list, no longer user-configurable. The 8
    // subcat paths live in TM_SUBCATS in 00-config.js; the scraper walks them
    // in order with first-subcat-wins dedupe.
    const tmInfo = el('div', { fontSize: '12px', color: '#333', lineHeight: '1.4' }, {
      text: 'TM categories (hardcoded): 8 subcats — card-games, childrens-games, dice-games, party-games, strategy-war-games, word-games, board-games/other, games-puzzles/other'
    });
    const tmInfoHint = el('div', { fontSize: '11px', color: '#666' }, {
      text: '(see docs/13-pipeline-pre-merged-data.md)'
    });

    // Auto-commit
    const autoRow = el('label', {
      display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'
    });
    const autoCb = el('input', {}, {
      type: 'checkbox', checked: !!cfg.auto_commit,
      on: { change: () => saveConfigKey('auto_commit', autoCb.checked) }
    });
    autoRow.append(autoCb,
      el('span', null, { text: 'Auto-commit (skip final confirmation prompt)' }));

    // Crawl speed — segmented control. Mirrors tm-bgbf's "Crawl speed"
    // terminology and the Fastest/Balanced/Safest preset names; the picked
    // preset writes through to the underlying `pacing_multiplier` config key
    // (unchanged) which the TM/BGG fetchers multiply into their delay
    // constants. CRAWL_SPEED_PRESETS + crawlSpeedLabelForMultiplier come
    // from 00-config.js.
    ensureCrawlSpeedStyle();
    const activeLabel = crawlSpeedLabelForMultiplier(cfg.pacing_multiplier);
    const crawlChip = el('span', null, {
      className: 'bsnz-seg-chip',
      text: activeLabel.charAt(0).toUpperCase() + activeLabel.slice(1)
    });
    const crawlLabel = el('div', { fontWeight: '600' });
    crawlLabel.append(document.createTextNode('Crawl speed'), crawlChip);
    // Plain-English tooltips per preset (shown via the native `title`
    // attribute on the segment label — that's the element the user actually
    // hovers).
    const CRAWL_SPEED_TOOLTIPS = {
      fastest:  'Quickest scrape. Higher chance of being temporarily blocked by Trade Me.',
      balanced: 'Recommended. A safe middle ground for everyday runs.',
      safest:   'Slowest scrape, lowest risk. Use after errors or for extra caution.'
    };
    const crawlSeg = el('fieldset', null, { className: 'bsnz-seg' });
    for (const key of Object.keys(CRAWL_SPEED_PRESETS)) {
      const id = `bsnz-crawl-${key}`;
      const radio = el('input', null, {
        type: 'radio', name: 'bsnz-crawl-speed', id, value: key,
        checked: key === activeLabel,
        on: { change: () => {
          if (!radio.checked) return;
          saveConfigKey('pacing_multiplier', CRAWL_SPEED_PRESETS[key]);
          crawlChip.textContent = key.charAt(0).toUpperCase() + key.slice(1);
        }}
      });
      const lbl = el('label', null, {
        htmlFor: id,
        title: CRAWL_SPEED_TOOLTIPS[key],
        text: key.charAt(0).toUpperCase() + key.slice(1)
      });
      crawlSeg.append(radio, lbl);
    }

    // Clear-all (two-step)
    const clearWrap = el('div', { borderTop: '1px solid #eee', paddingTop: '10px' });
    let clearArmed = false;
    const clearBtn = el('button', {
      padding: '6px 10px', background: '#c0392b', color: '#fff',
      border: 'none', borderRadius: '4px', cursor: 'pointer'
    }, { text: 'Clear all data (cache, PAT, settings — run history kept)', on: { click: () => {
      if (!clearArmed) {
        clearArmed = true;
        clearBtn.textContent = 'Click again to confirm — irreversible (Run history is preserved — use \'Clear history\' in the Run history modal to clear that separately.)';
        clearBtn.style.background = '#7d2018';
        setTimeout(() => {
          clearArmed = false;
          clearBtn.textContent = 'Clear all data (cache, PAT, settings — run history kept)';
          clearBtn.style.background = '#c0392b';
        }, 5000);
        return;
      }
      clearAllConfig();
      log('warn', 'All BSNZ pipeline data cleared.');
      closeSettings();
      refreshRunBtnEnabled();
    }}});
    clearWrap.append(clearBtn);

    dialog.append(
      titleRow,
      patLabel, patStatus, patInput, patBtnRow,
      tmInfo, tmInfoHint,
      autoRow,
      crawlLabel, crawlSeg,
      clearWrap
    );
    overlay.append(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });
    document.body.appendChild(overlay);
    settingsOverlay = overlay;
  }
  function closeSettings() {
    if (!settingsOverlay) return;
    settingsOverlay.remove();
    settingsOverlay = null;
  }

  function testPat(pat) {
    if (!pat) { log('error', 'PAT empty — cannot test.'); return; }
    log('info', 'Testing PAT against GitHub…');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}`,
      headers: {
        'Authorization': `token ${pat}`,
        'Accept':        'application/vnd.github+json'
      },
      onload: (r) => {
        if (r.status === 200) {
          log('info', 'PAT OK — repo accessible.');
          if (typeof GM_notification === 'function') {
            try { GM_notification({ text: 'PAT OK', title: 'BSNZ', timeout: 3000 }); } catch (_) {}
          }
        } else {
          log('error', `PAT test failed: HTTP ${r.status} ${r.statusText || ''}`.trim());
        }
      },
      onerror: (e) => log('error', 'PAT test network error:', e && e.error || 'unknown')
    });
  }
