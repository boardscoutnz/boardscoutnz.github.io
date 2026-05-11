// tprmky/bsnz-pipeline-src/01d-categories.js
// Categories panel for the BSNZ Pipeline dashboard. Lists the TM subcats
// the next/current run will walk; each name turns red + struck-through as
// 02-tm-scraper.js reports it complete. Runs inside the shared IIFE
// opened in 00-config.js — references TM_SUBCATS, TM_TEST_SUBCAT_SLUGS,
// and BSNZ from closure scope.

  let _categoriesStyleInjected = false;
  function ensureCategoriesStyle() {
    if (_categoriesStyleInjected) return;
    const s = document.createElement('style');
    s.textContent =
      '.bsnz-categories-panel { padding: 6px 0; }' +
      '.bsnz-categories-header { text-align: center; font-weight: 600;' +
      ' font-size: 12px; letter-spacing: 0.5px; color: #555;' +
      ' margin-bottom: 6px; }' +
      '.bsnz-categories-grid { display: grid;' +
      ' grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 12px;' +
      ' padding: 0 16px; }' +
      '.bsnz-cat { color: #1a1a1a; }' +
      '.bsnz-cat.done { color: #c0392b; text-decoration: line-through;' +
      ' text-decoration-color: #c0392b; }';
    document.head.appendChild(s);
    _categoriesStyleInjected = true;
  }

  // Build the panel DOM once. Returns the root <div> for buildPanel() to
  // splice into the body. Initial population is left to the caller via
  // window.bsnzRenderCategories().
  function buildCategoriesPanel() {
    ensureCategoriesStyle();
    const panel = document.createElement('div');
    panel.className = 'bsnz-categories-panel';
    panel.id = 'bsnz-categories-panel';
    const header = document.createElement('div');
    header.className = 'bsnz-categories-header';
    header.textContent = 'CATEGORIES:';
    const grid = document.createElement('div');
    grid.className = 'bsnz-categories-grid';
    grid.id = 'bsnz-categories-grid';
    panel.append(header, grid);
    return panel;
  }

  // Idempotent re-render. opts.active defaults to the current
  // test_scrape_mode-derived list; opts.completed defaults to empty.
  window.bsnzRenderCategories = function (opts) {
    opts = opts || {};
    const grid = document.getElementById('bsnz-categories-grid');
    if (!grid) return;
    const active = opts.active || (
      BSNZ.config && BSNZ.config.test_scrape_mode
        ? TM_SUBCATS.filter((s) => TM_TEST_SUBCAT_SLUGS.includes(s.slug))
        : TM_SUBCATS
    );
    const completedSet = new Set(opts.completed || []);
    grid.replaceChildren();
    for (const subcat of active) {
      const span = document.createElement('span');
      span.className = 'bsnz-cat' + (completedSet.has(subcat.slug) ? ' done' : '');
      span.textContent = subcat.name;
      grid.append(span);
    }
  };
