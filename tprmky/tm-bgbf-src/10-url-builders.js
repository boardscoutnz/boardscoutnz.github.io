  // ============================================================================
  // 11. URL BUILDERS
  // ============================================================================

  function categoryUrl(path, page, opts = {}) {
    const s = settings.get();
    const params = new URLSearchParams();
    if ((opts.condition ?? s.conditionFilter) && (opts.condition ?? s.conditionFilter) !== 'all') {
      params.set('condition', opts.condition ?? s.conditionFilter);
    }
    if (page && page > 1) params.set('page', String(page));
    if ((opts.sortOrder ?? s.sortOrder)) params.set('sort_order', opts.sortOrder ?? s.sortOrder);
    const qs = params.toString();
    return `${ORIGIN}${path}${qs ? '?' + qs : ''}`;
  }

  function listingDetailUrl(listingId) { return `${ORIGIN}/a/marketplace/listing/${listingId}`; }

