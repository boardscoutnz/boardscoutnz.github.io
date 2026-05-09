  // ============================================================================
  // 17. MENU COMMANDS & DIAGNOSTICS
  // ============================================================================

  function registerMenuCommands() {
    dbg('menu', 'registerMenuCommands: wiring Tampermonkey menu entries');
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('🎲 Open Board Games panel',  () => { ensureUI(); $('#panel').hidden = false; refreshPanelStatus(); });
    GM_registerMenuCommand('⏩  Quick run (incremental fetch + export)', () => runIncrementalFetch());
    GM_registerMenuCommand('▶️  Run full fetch (slow)',     () => runFullFetch());
    GM_registerMenuCommand('💾  Export full corpus now',    () => exportJsonForWebapp('manual-menu'));
    GM_registerMenuCommand('📥  Import JSON backup',       importJson);
    GM_registerMenuCommand('⚙️   Settings (edit JSON)',      editSettingsPrompt);
    GM_registerMenuCommand('🔍  Diagnose extraction (current page)', diagnoseExtraction);
    GM_registerMenuCommand('🌐  Diagnose fetch (test one URL)',     diagnoseFetch);
    GM_registerMenuCommand('🧹  Re-purge existing data (apply current title blacklist)', async () => {
      if (!confirm(`Apply the current v${VERSION} title blacklist to all listings already in the database? Listings whose title matches the blacklist will be permanently deleted from local storage.`)) return;
      log('Manual re-purge requested by user');
      await postProcessAll();
      await refreshPanelStatus();
      alert('Re-purge complete. See the console for the count.');
    });
    GM_registerMenuCommand('🗑️   Clear ALL data',           async () => {
      if (confirm('Wipe all stored Board Games data? This cannot be undone.')) {
        await dbDestroy(); alert('Cleared.');
      }
    });
  }

  function editSettingsPrompt() {
    const current = settings.get();
    const text = prompt('Edit settings as JSON (be careful):', JSON.stringify(current, null, 2));
    if (!text) return;
    try {
      const next = JSON.parse(text);
      settings.save(next);
      alert('Settings saved.');
    } catch (e) {
      alert('JSON parse failed: ' + e.message);
    }
  }

  async function diagnoseExtraction() {
    log('=== DIAGNOSTIC ===');
    log('URL:', location.href);
    const html = document.documentElement.outerHTML;
    const { listings, totalCount, source } = extractListingsFromPage(html);
    log(`Source: ${source}`);
    log(`Listings extracted: ${listings.length}`);
    log(`totalCount: ${totalCount}`);
    if (listings.length) {
      const first = listings[0];
      log('First raw listing keys:', Object.keys(first));
      log('First raw listing (full):', first);
      const sample = listings.slice(0, 5).map((r) => {
        const n = normaliseListing(r);
        return n && {
          listingId: n.listingId, title: n.title, condition: n.condition,
          priceDisplay: n.priceDisplay, priceNumeric: n.priceNumeric, priceLabel: n.priceLabel,
          region: n.region,                                        // v0.7.10: endDate dropped (always null)
          isExpansion: n.isExpansion,                              // v0.7.11: was isAccessory
        };
      });
      console.table(sample);
    }
    alert(`Diagnostic complete. ${listings.length} listings via ${source}. See console for details.`);
  }

  async function diagnoseFetch() {
    const cat = CATEGORIES[0];
    const url = categoryUrl(cat.path, 1, { condition: 'new' });
    log('=== FETCH DIAGNOSTIC ===');
    log('Target URL:', url);
    const t0 = Date.now();
    try {
      const html = await fetchHtml(url, { maxAttempts: 1 });
      const elapsed = Date.now() - t0;
      log(`Fetch OK in ${elapsed}ms; ${html.length} bytes received.`);
      const { listings, totalCount, source } = extractListingsFromPage(html);
      log(`Extraction: ${listings.length} listings via ${source}, totalCount=${totalCount}`);
      alert(`Fetch test OK in ${elapsed}ms.\n${listings.length} listings extracted via ${source}.\nSee console for details.`);
    } catch (e) {
      const elapsed = Date.now() - t0;
      err(`Fetch test FAILED after ${elapsed}ms:`, e && (e.message || e));
      alert(`Fetch test FAILED after ${elapsed}ms.\nError: ${e && (e.message || e)}\nSee console for details.\n\n• "fetch-timeout" → connection hung; try clearing cookies on trademe.co.nz or waiting an hour.\n• "challenge-page-detected" → Cloudflare challenge; same fix.\n• HTTP 4xx/5xx → server-side error.`);
    }
  }

