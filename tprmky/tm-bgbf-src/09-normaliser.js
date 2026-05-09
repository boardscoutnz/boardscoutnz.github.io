  // ============================================================================
  // 8. LISTING NORMALISER
  // ============================================================================

  // v0.7.10: the v0.7.1 endDate-probe diagnostic block was removed.
  // It conclusively proved that TradeMe's __NEXT_DATA__ doesn't
  // carry close-time data at all, so endDate has been retired
  // throughout. If TM ever changes that, restore the probe from
  // git history.

  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function bool(v) { return v === true || v === 'true' || v === 1; }

  function normaliseListing(raw, ctx = {}) {
    if (!raw) return null;
    const listingId = num(pickFirstValue(raw, ['listingId', 'ListingId', 'id']));
    if (!listingId) return null;

    const title = String(pickFirstValue(raw, ['title', 'Title', 'name']) || '').trim();

    const startPrice = num(pickFirstValue(raw, [
      'startPrice', 'StartPrice', 'currentBid', 'CurrentBid',
      'currentPrice', 'CurrentPrice', 'minimumNextBid', 'MinimumNextBid',
    ]));
    const buyNowPrice = num(pickFirstValue(raw, ['buyNowPrice', 'BuyNowPrice', 'buyNow', 'BuyNow']));
    const priceDisplay = pickFirstValue(raw, [
      'priceDisplay', 'PriceDisplay', 'displayPrice', 'DisplayPrice',
    ]);
    const parsedDisplay = parsePriceDisplay(priceDisplay);
    const priceNumeric = buyNowPrice ?? startPrice ?? parsedDisplay.numeric ?? null;
    let priceLabel = parsedDisplay.label;
    if (!priceLabel) {
      if (buyNowPrice != null && startPrice == null) priceLabel = 'Buy Now';
      else if (startPrice != null && buyNowPrice == null) priceLabel = 'Auction';
      else if (buyNowPrice != null && startPrice != null) priceLabel = 'Buy Now / Auction';
    }

    // v0.7.9: isClassified extraction dropped — see history.
    // v0.7.10: the standalone `isNew` capture and the condition
    // fallback below are gone too. The captured `isNew` field was
    // never read by anything; the fallback was only reachable if
    // ctx.condition was missing, which never happens on production
    // run paths (the bulk fetch always passes 'new' or 'used').
    // The diagnostic (`Diagnose extraction`) menu command hits the
    // no-context path and now just gets condition='unknown' — fine
    // for a debug dump.
    const hasBuyNow = buyNowPrice != null ? true : bool(pickFirstValue(raw, ['hasBuyNow', 'HasBuyNow']));

    const condition = (ctx.condition === 'new' || ctx.condition === 'used') ? ctx.condition : 'unknown';

    // v0.7.10: endDate extraction removed entirely. TradeMe's
    // __NEXT_DATA__ doesn't carry close-time data — verified by
    // the v0.7.1 probe that ran for several versions and never
    // matched any of the candidate field names.
    // v0.7.9: district + suburb extraction dropped — both came back
    // null on 100 % of 7,223 production listings. cleanLocationField
    // is still used for region.
    const regionRaw = pickFirstValue(raw, ['region', 'Region', 'regionName', 'RegionName']);
    const region    = cleanLocationField(regionRaw);

    // v0.7.0: the region purge (was a no-op since v0.4.0) is gone. The title
    // blacklist below remains the only fetch-time corpus filter.
    if (title && PURGE_TITLE_RX.test(title)) return null;

    const url = `${ORIGIN}/a/marketplace/listing/${listingId}`;

    // v0.7.10: dropped pictureHref (never used by the website),
    // endDate (always null), isNew (never read after capture),
    // and firstSeen/lastSeen (only consumer was the orphaned
    // delta-export feature, also removed in v0.7.10).
    return {
      listingId, title, subcat: ctx.subcat || null,
      startPrice, buyNowPrice, priceDisplay, priceNumeric, priceLabel,
      condition, hasBuyNow,
      region: region || null,
      url,
      // v0.7.11: expansion tag — set ONLY for surviving listings (the
      // blacklist purge above has already returned null for anything
      // in PURGE_TITLE_KEYWORDS, including the former accessory
      // keywords folded in for v0.7.11), so this only ever fires on
      // genuine board-game-domain listings.
      isExpansion: detectIsExpansion(title),
    };
  }



