  // ============================================================================
  // 4. SETTINGS
  // ============================================================================

  const settings = (() => {
    let cache = null;
    function load() {
      try {
        const raw = GM_getValue(GM_KEY_SETTINGS, null);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { ...DEFAULT_SETTINGS, ...parsed };
      } catch (e) {
        warn('settings load failed, using defaults', e);
        return { ...DEFAULT_SETTINGS };
      }
    }
    function save(next) {
      cache = { ...DEFAULT_SETTINGS, ...next };
      GM_setValue(GM_KEY_SETTINGS, JSON.stringify(cache));
      return cache;
    }
    return {
      get() { if (!cache) cache = load(); return cache; },
      save,
      reset() { cache = { ...DEFAULT_SETTINGS }; GM_setValue(GM_KEY_SETTINGS, JSON.stringify(cache)); return cache; },
    };
  })();

