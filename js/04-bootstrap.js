'use strict';

// ==========================================================================
// 04-bootstrap.js — DOMContentLoaded handler: sets app version, kicks off BGG cache + listings load
// ==========================================================================

// ============================================================================
// 4. Bootstrap
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  dbg('init', `DOMContentLoaded — Board Scout NZ v${APP_VERSION} starting up`);
  document.getElementById('app-version').textContent = `v${APP_VERSION}`;

  dbgGroup('init', 'wiring controls');
  wireFilterControls();
  wireToolbarControls();
  wireHelpModal();
  wireGridHint();
  dbgGroupEnd('init');

  // Refresh the data-updated pill's relative-time text once a minute.
  setInterval(refreshDataMetaPillRelative, 60_000);
  dbg('init', 'data-meta pill auto-refresh interval scheduled (60s)');

  dbg('init', 'kicking off async loads (BGG cache + listings) in parallel');
  loadBggCache();
  autoLoadCommittedListings();
});

async function autoLoadCommittedListings() {
  dbg('data', `autoLoadCommittedListings: fetching ${LISTINGS_URL}`);
  dbgTime('listings fetch+parse');
  try {
    const res = await fetch(LISTINGS_URL, { cache: 'no-cache' });
    dbg('data', `listings fetch returned: status=${res.status}, ok=${res.ok}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    dbg('data', `listings response body received: ${text.length.toLocaleString()} chars (~${(text.length / 1024).toFixed(1)} KB)`);
    if (text.trim().startsWith('<')) throw new Error('not JSON (probably a 404 page)');
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error(`JSON parse failed: ${e.message}`); }
    dbgTimeEnd('listings fetch+parse');
    dbg('data', 'listings JSON parsed successfully — calling ingestJson');
    await ingestJson(parsed);
  } catch (e) {
    dbgTimeEnd('listings fetch+parse');
    dbgError('data', 'listings auto-load failed:', e.message);
    console.warn('[bsnz] listings auto-load failed:', e.message);
    showEmptyState(e.message);
  }
}

function showEmptyState(message) {
  dbgWarn('data', `showEmptyState: "${message}"`);
  const empty = document.getElementById('empty-state');
  const grid  = document.getElementById('grid-container');
  const msgEl = document.getElementById('empty-state-message');
  if (grid) grid.hidden = true;
  if (empty) empty.hidden = false;
  if (msgEl && message) {
    msgEl.textContent = `The listings file couldn't be loaded from the repository (${message}). Please try refreshing the page.`;
  }
}

