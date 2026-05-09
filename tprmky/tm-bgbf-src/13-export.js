  // ============================================================================
  // 15. EXPORT — JSON IS PRIMARY, CSV IS A BACKUP
  // ============================================================================

  function downloadFile(name, mime, content) {
    grp('download', `downloadFile("${name}", ${mime}, ${content.length.toLocaleString()} chars)`);
    const sizeKB = (content.length / 1024).toFixed(1);
    dbg('download', `payload size: ${content.length.toLocaleString()} chars (~${sizeKB} KB)`);
    try {
      const blob = new Blob([content], { type: mime });
      dbg('download', `Blob constructed: type="${blob.type}", size=${blob.size}`);
      const url = URL.createObjectURL(blob);
      dbg('download', `Object URL created: ${url}`);

      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      dbg('download', `<a> appended to body, dispatching click()`);
      a.click();
      dbg('download', `click() dispatched — browser should now save "${name}"`);
      dbg('download', '⚠️  If you see no download appear: Chrome is most likely silently blocking');
      dbg('download', '   multi-file downloads from trademe.co.nz. Click the address-bar download');
      dbg('download', '   icon and choose "Always allow", or visit chrome://settings/content/automaticDownloads.');

      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
        dbg('download', `cleaned up object URL + anchor for "${name}"`);
      }, 1000);
    } catch (e) {
      dbgErr('download', `downloadFile threw for "${name}":`, e);
      grpEnd();
      throw e;
    }
    grpEnd();
  }

 // v0.7.7: project a stored listing down to the slim shape the
  // website actually consumes. Update this list when adding a new
  // user-facing field.
  //
  // Output schema (as of v0.7.11; schemaVersion bumped 6 → 7):
  //   listingId, title, subcat, condition, isExpansion, isNewListing,
  //   priceNumeric, priceDisplay, priceLabel, hasBuyNow, region, url
  //
  // v0.7.11 changes vs the v0.7.10 schema (schemaVersion 6):
  //   • isAccessory REMOVED — the Accessories view-mode has been
  //     retired and accessory keywords were folded into
  //     PURGE_TITLE_KEYWORDS, so those listings no longer reach the
  //     export. The website's normaliseImportedListing now reads
  //     isExpansion in its place (also defaults to false on legacy
  //     snapshots that pre-date this version).
  //   • isExpansion ADDED — set by detectIsExpansion at normalise
  //     time, used by the website's "Board Games" / "Expansions"
  //     mode toggle.
  //
  // To restore any of the dropped fields: re-add the line below AND
  // restore the extraction in normaliseListing.

  function slimListingForExport(l) {
    return {
      listingId:      l.listingId,
      title:          l.title,
      subcat:         l.subcat,
      condition:      l.condition,
      isExpansion:    !!l.isExpansion,
      isNewListing:   !!l.isNewListing,
      priceNumeric:   l.priceNumeric,
      priceDisplay:   l.priceDisplay,
      priceLabel:     l.priceLabel,
      hasBuyNow:      !!l.hasBuyNow,
      region:         l.region,
      url:            l.url,
    };
  }

  /**
   * The web-app-friendly export. JSON. Includes everything the static site
   * needs: listings + meta. Versioned so the static site can detect
   * schema mismatches. Sellers + overrides stores were dropped from the
   * blob in v0.7.7 along with the classifier removal.
   *
   * v0.7.6: every step traced via the new `dbg('export', …)` helpers, the
   * sample download now uses a 1.5 s gap (up from 0.5 s) to avoid Chrome's
   * silent multi-download blocker, and a sample of zero rows now emits a
   * visible warning instead of a silent empty file.
   */
  async function exportJsonForWebapp(reason = 'manual') {
    grp('export', `=== exportJsonForWebapp("${reason}") ===`);
    const totalT = startTimer();

    dbg('export', 'reading IndexedDB stores…');
    const dbT = startTimer();
    const fullListings = await dbGetAll(STORE_LISTINGS);
    const listings = fullListings.map(slimListingForExport);
    dbg('export', `slimmed export shape: ${fullListings.length.toLocaleString()} listings → ${Object.keys(slimListingForExport(fullListings[0] || {})).length} fields per row`);
    const meta = await dbGetAll(STORE_META);
    dbg('export', `IndexedDB read complete in ${dbT()}: ` +
      `${listings.length.toLocaleString()} listings, ${meta.length.toLocaleString()} meta entries`);

    const blob = {
      version: VERSION,
      schemaVersion: 7,        // v0.7.11: isAccessory removed, isExpansion added; accessory keywords folded into PURGE_TITLE_KEYWORDS
      exportedAt: nowIso(),
      reason,
      stats: {
        listings: listings.length,
      },
      listings, meta,
    };
    dbg('export', 'blob constructed:', {
      version:       blob.version,
      schemaVersion: blob.schemaVersion,
      exportedAt:    blob.exportedAt,
      reason:        blob.reason,
      stats:         blob.stats,
    });

    // v0.5.0: Filename is plain "listings.json" so it can be moved straight
    // into the static site's data/ folder without renaming. The static site
    // auto-loads ./data/listings.json on startup.
    const filename = 'listings.json';
    const stringifyT = startTimer();
    const fullJson = JSON.stringify(blob, null, 2);
    dbg('export', `JSON.stringify (full): ${fullJson.length.toLocaleString()} chars in ${stringifyT()}`);

    dbg('export', `triggering download #1 → "${filename}"`);
    downloadFile(filename, 'application/json', fullJson);

    // ---- Also emit listings-example.json (structural reference) ----
    // Same envelope as the full export, just a 160-listing cross-section
    // so the file shape stays current without git-committing the multi-MB
    // full corpus. v0.7.14: gated behind the panel checkbox "Also export
    // listings-example.json (sample)" — when unchecked, this whole block
    // is skipped (no buildListingsSample call, no 1500ms gap sleep, no
    // second downloadFile invocation). The full listings.json above is
    // unconditional.
    let sampleEmitted = false;
    if (!isExportSampleEnabled()) {
      dbg('export', 'sample export disabled by panel checkbox — skipping listings-example.json');
    } else {
    grp('sample', '--- emitting listings-example.json ---');
    try {
      const sampleListings = buildListingsSample(listings);
      const sampleObj = {
        ...blob,
        reason: 'sample',
        stats: { ...blob.stats, listings: sampleListings.length },
        listings: sampleListings,
      };
      const sampleJson = JSON.stringify(sampleObj, null, 2);
      const sampleSizeKB = (sampleJson.length / 1024).toFixed(1);
      dbg('sample', `sample envelope: ${sampleListings.length} listings, ` +
        `${sampleJson.length.toLocaleString()} chars (~${sampleSizeKB} KB)`);

      if (sampleListings.length === 0) {
        dbgWarn('sample', '⚠️  Sample contains 0 listings — the file will be effectively empty.');
        dbgWarn('sample', '   Continuing anyway so the file still gets written for diagnosis.');
      }

      // v0.7.6: bumped from 500ms → 1500ms. Chrome's heuristic for
      // "is this site auto-downloading multiple files?" is sensitive to
      // tight timing. With 500ms the second download was being silently
      // dropped on trademe.co.nz; 1500ms reliably lands in a fresh task
      // and the click is honoured. If it's still being blocked despite
      // this gap, the user needs to allow multi-downloads at:
      //   chrome://settings/content/automaticDownloads
      const SAMPLE_DOWNLOAD_DELAY_MS = 1500;
      dbg('sample', `waiting ${SAMPLE_DOWNLOAD_DELAY_MS}ms before second download to dodge Chrome's multi-download blocker…`);
      await new Promise((r) => setTimeout(r, SAMPLE_DOWNLOAD_DELAY_MS));

      dbg('sample', 'triggering download #2 → "listings-example.json"');
      downloadFile('listings-example.json', 'application/json', sampleJson);
      sampleEmitted = true;
      dbg('sample', '✅ listings-example.json download dispatched. ' +
        'If no file appeared, check Chrome\'s download blocker (see download category logs).');
    } catch (e) {
      dbgErr('sample', 'sample emit FAILED — main listings.json is still safe:', e);
    } finally {
      grpEnd(); // close 'sample' group
    }
    }

    log(`Exported ${listings.length} listings to ${filename} (${reason})${sampleEmitted ? ' + sample' : ''}`);
    const exportedAt = nowIso();
    await dbPut(STORE_META, { key: 'lastExportAt', value: exportedAt });
    try { localStorage.setItem('bgbf.lastExportAt', exportedAt); } catch (e) { /* ignore */ }
    dbg('export', `bookkeeping done: lastExportAt=${exportedAt}`);
    dbg('export', `=== exportJsonForWebapp finished in ${totalT()} ===`);
    grpEnd(); // close 'export' group
    return filename;
  }

  /**
   * Triggered automatically at the end of full or incremental runs (when
   * autoExportOnRunComplete is on). v0.7.10 simplified this from a
   * multi-format dispatcher to "always exports JSON" — exportCsv was
   * removed (unused) and exportDeltaOnly was removed (the website
   * always rejected delta exports).
   */
  async function autoExport(reason) {
    grp('export', `autoExport(reason="${reason}")`);
    try {
      dbg('export', '→ autoExport: running exportJsonForWebapp');
      await exportJsonForWebapp(reason);
      dbg('export', '✅ autoExport complete');
    } catch (e) {
      dbgErr('export', '❌ autoExport threw:', e);
      throw e;
    } finally {
      grpEnd();
    }
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const blob = JSON.parse(text);
        if (blob.listings)  await dbBulkPut(STORE_LISTINGS,  blob.listings);
        if (blob.meta) for (const m of blob.meta) await dbPut(STORE_META, m);
        await postProcessAll();
        await refreshPanelStatus();
        alert(`Imported ${blob.listings?.length || 0} listings.`);
      } catch (e) { alert('Import failed: ' + e.message); }
    });
    input.click();
  }

