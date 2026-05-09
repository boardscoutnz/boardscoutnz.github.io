  // ============================================================================
  // 12. BULK RUN ORCHESTRATORS
  // ============================================================================

  const runState = {
    active: false, type: null, abortRequested: false,
    progress: { phase: 'idle', subcat: null, page: 0, totalSubcats: 0, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: '' },
    listeners: new Set(),
  };
  function emitRun() { for (const l of runState.listeners) { try { l(runState); } catch {} } }
  function setProgress(p) { runState.progress = { ...runState.progress, ...p }; emitRun(); }
  function onRun(fn) { runState.listeners.add(fn); return () => runState.listeners.delete(fn); }

  async function runFullFetch(opts = {}) {
    grp('run', `=== runFullFetch starting === (opts: ${JSON.stringify(opts)})`);
    const runT = startTimer();
    if (runState.active) {
      dbgWarn('run', 'a run is already active; ignoring this call');
      grpEnd();
      log('a run is already active; ignore');
      return;
    }
    runState.active = true;
    runState.type = 'full';
    runState.abortRequested = false;

    const cf = opts.condition ?? settings.get().conditionFilter ?? 'all';
    const conditionsToFetch = cf === 'all' ? ['new', 'used'] : [cf];
    const totalPasses = CATEGORIES.length * conditionsToFetch.length;

    setProgress({ phase: 'starting', subcat: null, page: 0, totalSubcats: totalPasses, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: 'Starting full fetch…' });

    const startedAt = nowIso();
    const cur = { runId: startedAt, type: 'full', startedAt, lastSubcatIndex: -1, lastPage: 0, complete: false };
    GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

    const seenListingIds = new Set();
    let consecutiveFailures = 0;
    let passIdx = 0;

    try {
      for (let i = 0; i < CATEGORIES.length; i++) {
        if (runState.abortRequested) { setProgress({ phase: 'aborted', message: 'Aborted by user.' }); return; }
        const sc = CATEGORIES[i];
        for (let j = 0; j < conditionsToFetch.length; j++) {
          if (runState.abortRequested) { setProgress({ phase: 'aborted', message: 'Aborted by user.' }); return; }
          const cond = conditionsToFetch[j];
          const passLabel = conditionsToFetch.length > 1 ? `${sc.name} (${cond})` : sc.name;

          cur.lastSubcatIndex = i; cur.lastPage = 0;
          GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));
          log(`>>> Pass ${passIdx + 1}/${totalPasses}: ${passLabel} (path=${sc.path})`);
          setProgress({ phase: 'fetching', subcat: passLabel, page: 1, doneSubcats: passIdx, message: `Fetching ${passLabel}…` });

          let page = 1;
          let pagesTotalEstimate = null;
          const seenInPass = new Set();
          let pageSize = null;

          while (true) {
            if (runState.abortRequested) break;
            const url = categoryUrl(sc.path, page, { ...opts, condition: cond });
            let html;
            try { html = await fetchHtml(url); }
            catch (e) {
              consecutiveFailures++;
              setProgress({ errors: runState.progress.errors + 1, message: `Error on ${passLabel} p${page}: ${e.message}` });
              if (e.message === 'challenge-page-detected' || consecutiveFailures >= settings.get().maxConsecutiveFailures) {
                setProgress({ phase: 'aborted', message: 'Aborting: too many failures or challenge page.' });
                return;
              }
              await sleep(settings.get().abortBackoffSec * 1000);
              continue;
            }
            consecutiveFailures = 0;

            const { listings, totalCount, source } = extractListingsFromPage(html);
            if (!listings.length) {
              if (page === 1) warn(`No listings on first page of ${sc.slug} (${cond}) via ${source}`);
              break;
            }
            if (page === 1 && totalCount && listings.length) {
              pageSize = listings.length;
              pagesTotalEstimate = Math.ceil(totalCount / pageSize);
            }

            const normalised = listings
              .map((r) => normaliseListing(r, { subcat: sc.slug, condition: cond }))
              .filter(Boolean);

            let newOnThisPage = 0;
            for (const n of normalised) {
              if (!seenInPass.has(n.listingId)) {
                seenInPass.add(n.listingId);
                seenListingIds.add(n.listingId);
                newOnThisPage++;
              }
            }
            if (newOnThisPage === 0) {
              log(`${sc.slug} (${cond}) page ${page}: ${listings.length} listings but 0 new — assuming end of pagination`);
              setProgress({ page, message: `${passLabel} page ${page}: end reached (no new listings)` });
              break;
            }

            const merged = [];
            const stamp = nowIso();
            for (const n of normalised) {
              const existing = await dbGet(STORE_LISTINGS, n.listingId);
              if (existing) merged.push({ ...existing, ...n, lastSeenAt: stamp });
              else merged.push({ ...n, lastSeenAt: stamp });
            }
            await dbBulkPut(STORE_LISTINGS, merged);

            // v0.7.8: feed the per-pass scrape set + running tail
            // sentinel for the next Quick Run's expiration baseline.
            // Mirrors lines ~1217-1226 of runIncrementalFetch.
            const pk = passKeyOf(sc, cond);
            if (!currSeenByPass[pk]) currSeenByPass[pk] = new Set();
            for (const m of merged) {
              currSeenByPass[pk].add(m.listingId);
              tailByPass[pk] = { listingId: m.listingId, capturedAt: nowIso() };
            }

            setProgress({
              page,
              listingsAccumulated: runState.progress.listingsAccumulated + newOnThisPage,
              message: `${passLabel} page ${page}: +${newOnThisPage} new (source=${source})${pagesTotalEstimate ? ` of ~${pagesTotalEstimate} pages` : ''}`,
            });

            cur.lastPage = page;
            GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

            if (pagesTotalEstimate && page >= pagesTotalEstimate) break;
            if (totalCount && seenInPass.size >= totalCount) break;

            page++;
            const cap = settings.get().maxPagesPerSubcat || 60;
            if (page > cap) { warn(`safety cap: ${cap} pages on ${sc.slug} (${cond})`); break; }
            await politeSleep();
          }

          passIdx++;
          setProgress({ doneSubcats: passIdx });
        }
      }

      dbg('run', `→ phase transition: crawl complete, entering seller-enrichment. listingsAccumulated=${runState.progress.listingsAccumulated}`);

      if (!runState.abortRequested) {
        dbg('run', '→ phase transition: crawl complete, entering post-process');
        setProgress({ phase: 'post-processing', message: 'Tidying up…' });
        await postProcessAll();

        // v0.7.12: lastSeenAt reap + content-based dedup. Same scheme
        // used by Quick Run. See reapAndDedup() near abortRun().
        const { reaped, dupesRemoved } = await reapAndDedup('Full Fetch');
        dbg('run', `Full Fetch cleanup: reaped=${reaped}, dupesRemoved=${dupesRemoved}`);
      }

      cur.complete = true;
      GM_setValue(GM_KEY_CURRENT_RUN, JSON.stringify(cur));

      const lastFetchAt = nowIso();
      await dbPut(STORE_META, { key: 'lastFetchAt', value: lastFetchAt });
      await dbPut(STORE_META, { key: 'lastRunSummary', value: { ...cur, completedAt: lastFetchAt, listings: runState.progress.listingsAccumulated } });

      // v0.7.8: persist per-pass scrape sets + tails so the next
      // Quick Run has a complete expiration baseline to compare
      // against. Mirrors lines ~1288-1297 of runIncrementalFetch.
      const scrapeSetsForStorage = {};
      for (const [pk, set] of Object.entries(currSeenByPass)) {
        scrapeSetsForStorage[pk] = [...set];
      }
      await dbPut(STORE_META, { key: 'currSeenByPass.v1', value: scrapeSetsForStorage });
      await dbPut(STORE_META, { key: 'tailByPass.v1',     value: tailByPass });
      dbg('run', `Full Fetch: persisted scrape sets for next run: ${Object.keys(scrapeSetsForStorage).length} passes, tail sentinels recorded for ${Object.keys(tailByPass).length} passes`);

      setProgress({ phase: 'complete', message: `Done. ${runState.progress.listingsAccumulated} listings.` });

      if (settings.get().autoExportOnRunComplete) {
        setProgress({ message: 'Exporting…' });
        dbg('run', '→ phase transition: post-process complete, entering autoExport');
        await autoExport('full-fetch-complete');
        setProgress({ message: 'Export complete — listings.json downloaded.' });
      }
    } finally {
      runState.active = false;
      emitRun();
      dbg('run', `=== runFullFetch finished in ${runT()} (phase=${runState.progress.phase}, ` +
        `listings=${runState.progress.listingsAccumulated}, errors=${runState.progress.errors}) ===`);
      grpEnd(); // close 'run' group
    }
  }

  async function runIncrementalFetch() {
    if (runState.active) { log('a run is already active'); return; }
    runState.active = true;
    runState.type = 'incremental';
    runState.abortRequested = false;

    const cf = settings.get().conditionFilter ?? 'all';
    const conditionsToFetch = cf === 'all' ? ['new', 'used'] : [cf];
    const totalPasses = CATEGORIES.length * conditionsToFetch.length;

    setProgress({ phase: 'starting', subcat: null, page: 0, totalSubcats: totalPasses, doneSubcats: 0, listingsAccumulated: 0, errors: 0, message: 'Starting incremental fetch…' });

    // v0.7.6: snapshot the IDs known to IndexedDB BEFORE this run
    // begins. Any listing we encounter during the run whose ID is
    // not in this set is flagged isNewListing=true so the website
    // can render a red "NEW" badge.
    //
    // v0.7.10: BULK-CLEAR isNewListing on every existing record
    // up-front, before any pagination begins. Previously the
    // forward walk and tail-anchor sweep cleared the flag only
    // when they re-encountered a known listing — but Quick Run
    // stops the forward walk at the first all-known page, so any
    // listing on a page neither walk visits kept its stale
    // "NEW" badge from the previous run. Clearing up front makes
    // this run AUTHORITATIVE: by end of run, isNewListing=true
    // reflects exactly the listings genuinely new on this run,
    // and nothing else.
    const allKnown = await dbGetAll(STORE_LISTINGS);
    {
      const cleared = [];
      for (const l of allKnown) {
        if (l.isNewListing) {
          cleared.push({ ...l, isNewListing: false });
        }
      }
      if (cleared.length) {
        await dbBulkPut(STORE_LISTINGS, cleared);
        dbg('run', `Quick Run pre-clear: cleared isNewListing on ${cleared.length} previously-flagged record(s)`);
      } else {
        dbg('run', 'Quick Run pre-clear: no records had isNewListing=true to clear');
      }
    }

    // v0.7.12: per-pass scrape-set tracking has been removed. The old
    // tail-anchor / currSeenByPass scheme silently failed for every pass
    // where pagesTotalEstimate came back null (i.e., basically every
    // pass — see the v0.7.11 diagnostic logs that surfaced this). The
    // replacement is per-listing lastSeenAt tracking + a stale-record
    // reap at the end of the run; see reapAndDedup() and Diff 3 above.
    const knownIds = new Set(allKnown.map((l) => l.listingId));
    dbg('run', `Quick Run: ${knownIds.size.toLocaleString()} listing IDs known from previous runs`);
    let newThisRun = 0;
    let resurfacedThisRun = 0;   // already-known listings still visible — flag cleared
    let passIdx = 0;

    try {
      for (let i = 0; i < CATEGORIES.length; i++) {
        if (runState.abortRequested) break;
        const sc = CATEGORIES[i];
        for (let j = 0; j < conditionsToFetch.length; j++) {
          if (runState.abortRequested) break;
          const cond = conditionsToFetch[j];
          const passLabel = conditionsToFetch.length > 1 ? `${sc.name} (${cond})` : sc.name;
          setProgress({ phase: 'fetching', subcat: passLabel, doneSubcats: passIdx, message: `Incremental: ${passLabel}` });

          let page = 1, stop = false;
          // v0.7.8: track pages-total so the tail-anchor sweep below
          // knows where the LAST page is. We previously discarded
          // totalCount because Quick Run had no use for it.
          let pagesTotalEstimate = null;
          let pageSize = null;
          while (!stop) {
            if (runState.abortRequested) break;
            const url = categoryUrl(sc.path, page, { sortOrder: 'expirydesc', condition: cond });
            let html;
            try { html = await fetchHtml(url); }
            catch (e) { setProgress({ errors: runState.progress.errors + 1, message: `Error: ${e.message}` }); break; }
            const { listings, totalCount } = extractListingsFromPage(html);
            if (!listings.length) break;
            if (page === 1 && totalCount && listings.length) {
              pageSize = listings.length;
              pagesTotalEstimate = Math.ceil(totalCount / pageSize);
            }

            let newCount = 0;
            const recs = [];
            const stamp = nowIso();
            for (const raw of listings) {
              const n = normaliseListing(raw, { subcat: sc.slug, condition: cond });
              if (!n) continue;
              if (knownIds.has(n.listingId)) {
                // Already in DB. isNewListing was bulk-cleared on every
                // record at run start, so the merge here refreshes
                // price/title/etc. and stamps lastSeenAt so the
                // post-run reap leaves it alone.
                const existing = await dbGet(STORE_LISTINGS, n.listingId);
                if (existing) {
                  recs.push({ ...existing, ...n, lastSeenAt: stamp });
                  resurfacedThisRun++;
                }
                continue;
              }
              knownIds.add(n.listingId);
              recs.push({ ...n, isNewListing: true, lastSeenAt: stamp });
              newCount++;
              newThisRun++;
            }

            if (recs.length) await dbBulkPut(STORE_LISTINGS, recs);

            setProgress({ page, listingsAccumulated: runState.progress.listingsAccumulated + newCount, message: `${passLabel} p${page}: ${newCount} new` });
            // v0.7.12: NO early-stop on newCount === 0. Every page in the
            // pass paginates so every active listing's lastSeenAt gets
            // refreshed — that's what makes the post-run reap able to
            // identify expired listings reliably. Loop now exits via the
            // `if (!listings.length) break;` above (true end of
            // pagination) or the safety cap below.
            page++;
            if (page > 50) break;
            await politeSleep();
          }

          passIdx++;
          setProgress({ doneSubcats: passIdx });
        }
      }

      if (!runState.abortRequested) {
        // v0.7.12: per-listing lastSeenAt reap + content-based dedup.
        // Replaces the old per-pass tail-anchor sweep + currSeenByPass
        // expiration comparison, which silently failed for every pass
        // where extractListingsFromPage's totalCount came back null.
        // See reapAndDedup() definition near abortRun().
        const { reaped, dupesRemoved } = await reapAndDedup('Quick Run');
        dbg('run', `Quick Run cleanup: reaped=${reaped}, dupesRemoved=${dupesRemoved}`);

        await postProcessAll();
        await dbPut(STORE_META, { key: 'lastFetchAt', value: nowIso() });
      }

      dbg('run', `Quick Run summary: ${newThisRun.toLocaleString()} new listings flagged isNewListing=true, ${resurfacedThisRun.toLocaleString()} previously-known listings refreshed (isNewListing cleared)`);

      setProgress({ phase: 'complete', message: `Incremental done. +${runState.progress.listingsAccumulated} new.` });

      if (settings.get().autoExportOnRunComplete) {
        setProgress({ message: 'Exporting…' });
        await autoExport('incremental-fetch-complete');
        setProgress({ message: 'Export complete — listings.json downloaded.' });
      }
    } finally {
      runState.active = false;
      emitRun();
    }
  }

  async function abortRun() {
    runState.abortRequested = true;
    setProgress({ message: 'Abort requested…' });
  }

  // v0.7.12: shared post-run cleanup. Called by both Quick Run and Full
  // Fetch after their main pagination loop finishes. Two passes:
  //
  //   1) lastSeenAt reap — delete any listing whose `lastSeenAt` field is
  //      older than STALE_LISTING_DAYS, OR is missing entirely (the
  //      latter only happens on the first run after upgrading from
  //      v0.7.11 or earlier; after that, every active listing should
  //      always have a fresh stamp).
  //
  //   2) Content-based dedup — group by (title|price|condition|region|
  //      subcat) and, in any group with >1 entry, keep the highest
  //      listingId (TM IDs are sequential, so the highest is the
  //      most recent relisting) and delete the rest.
  //
  // Returns { reaped, dupesRemoved } for the caller to log.
  async function reapAndDedup(label) {
    setProgress({ message: 'Checking for stale listings…' });
    const all = await dbGetAll(STORE_LISTINGS);
    const cutoffMs = Date.now() - (STALE_LISTING_DAYS * 24 * 60 * 60 * 1000);
    const stale = [];
    for (const l of all) {
      const seenMs = l.lastSeenAt ? new Date(l.lastSeenAt).getTime() : 0;
      if (seenMs < cutoffMs) stale.push(l.listingId);
    }
    for (const id of stale) await dbDelete(STORE_LISTINGS, id);
    dbg('run', `${label}: lastSeenAt reap removed ${stale.length} listing(s) unseen for >${STALE_LISTING_DAYS} days`);

    setProgress({ message: 'Deduplicating relisted items…' });
    const remaining = await dbGetAll(STORE_LISTINGS);
    const matchKey = (l) =>
      `${(l.title || '').trim().toLowerCase()}|` +
      `${l.priceNumeric ?? ''}|` +
      `${l.condition ?? ''}|` +
      `${l.region ?? ''}|` +
      `${l.subcat ?? ''}`;
    const groups = new Map();
    for (const l of remaining) {
      const key = matchKey(l);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }
    let dupesRemoved = 0;
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      // Highest listingId wins — TM IDs are monotonic, so the largest
      // is the most recent relisting. Older entries with identical
      // content get deleted.
      group.sort((a, b) => b.listingId - a.listingId);
      for (let i = 1; i < group.length; i++) {
        await dbDelete(STORE_LISTINGS, group[i].listingId);
        dupesRemoved++;
      }
    }
    dbg('run', `${label}: content-dedup removed ${dupesRemoved} duplicate-content listing(s) (relistings under new IDs)`);

    return { reaped: stale.length, dupesRemoved };
  }

