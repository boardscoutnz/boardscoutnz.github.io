  // ============================================================================
  // 14. POST-PROCESS
  // ============================================================================

  // v0.7.7: was reclassifyAll(). The Personal/Business classification
  // pipeline has been removed entirely; this function now exists
  // solely to do the non-classification housekeeping that used to ride
  // along with the reclassify pass:
  //   • title-blacklist purge (PURGE_TITLE_RX)
  //   • expansion re-tagging (detectIsExpansion)         (v0.7.11: was accessory re-tagging)
  //   • region whitespace cleaning            (v0.7.9: district + suburb removed)
  //   • backfilling priceNumeric / priceLabel from priceDisplay if a
  //     listing arrived without them
  //   • v0.7.11 legacy-field stripping: `isAccessory` left over from
  //     pre-v0.7.11 records gets deleted in place along with the
  //     pre-existing v0.7.10 strip list (firstSeen, lastSeen, endDate,
  //     pictureHref, isNew, isClassified, district, suburb, memberId,
  //     nickname, classification). This makes the "🧹 Re-purge"
  //     command a one-shot upgrade tool too: run it once after
  //     installing v0.7.11 and IndexedDB is clean.
  // It is called at the end of every full and incremental run, and
  // by the "Re-purge existing data" menu command.
  async function postProcessAll() {
    let listings = await dbGetAll(STORE_LISTINGS);

    // ---- Title-blacklist purge ----------------------------------------
    const purgeIds = [];
    for (const l of listings) {
      if (l.title && PURGE_TITLE_RX.test(String(l.title))) {
        purgeIds.push(l.listingId);
      }
    }
    if (purgeIds.length) {
      log(`Purging ${purgeIds.length} listings (title-blacklist match)`);
      for (const id of purgeIds) await dbDelete(STORE_LISTINGS, id);
      const removed = new Set(purgeIds);
      listings = listings.filter((l) => !removed.has(l.listingId));
    }

    // ---- Re-tag expansion status -------------------------------------
    // v0.7.11: was a re-tag of isAccessory. The accessory partition
    // has been retired (its keywords moved into PURGE_TITLE_KEYWORDS,
    // dropping those listings entirely at fetch time); the expansion
    // partition replaces it. Re-running this on every postProcess pass
    // means a future tweak to detectIsExpansion's heuristic propagates
    // to the existing IndexedDB corpus the moment the user invokes the
    // "🧹 Re-purge" menu command — no need to refetch.
    for (const l of listings) {
      l.isExpansion = detectIsExpansion(l.title);
    }

    // ---- Whitespace + price housekeeping + legacy-field strip -------
    const LEGACY_FIELDS = [
      // v0.7.9 removals
      'district', 'suburb', 'isClassified',
      // v0.7.10 removals
      'firstSeen', 'lastSeen', 'endDate', 'pictureHref', 'isNew',
      // v0.7.11 removal — Accessories partition retired; the field is
      // explicitly deleted so re-purging an existing IndexedDB corpus
      // doesn't leave stale isAccessory values floating in records.
      'isAccessory',
      // even-older classifier vestiges
      'memberId', 'nickname', 'classification',
    ];
    for (const l of listings) {
      const cleanedR = cleanLocationField(l.region);
      if (cleanedR !== l.region) l.region = cleanedR;
      for (const f of LEGACY_FIELDS) {
        if (l[f] !== undefined) delete l[f];
      }

      if (l.priceNumeric == null || l.priceLabel == null) {
        const parsed = parsePriceDisplay(l.priceDisplay);
        if (l.priceNumeric == null) l.priceNumeric = l.buyNowPrice ?? l.startPrice ?? parsed.numeric ?? null;
        if (l.priceLabel == null) {
          let lbl = parsed.label;
          if (!lbl) {
            if      (l.buyNowPrice != null && l.startPrice  == null) lbl = 'Buy Now';
            else if (l.startPrice  != null && l.buyNowPrice == null) lbl = 'Auction';
            else if (l.buyNowPrice != null && l.startPrice  != null) lbl = 'Buy Now / Auction';
          }
          l.priceLabel = lbl || null;
        }
      }
    }

    await dbBulkPut(STORE_LISTINGS, listings);
    dbg('run', `postProcessAll done: ${listings.length.toLocaleString()} listings retained, ${purgeIds.length.toLocaleString()} purged on title blacklist`);
  }

