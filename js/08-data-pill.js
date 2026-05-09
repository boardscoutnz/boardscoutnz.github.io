'use strict';

// ==========================================================================
// 08-data-pill.js — Topbar 'Data updated X ago' pill (green→orange→red age states)
// ==========================================================================

// ============================================================================
// 8. Data-updated pill
// ============================================================================

let lastExportedAt = null;

function updateDataMetaPill(exportedAt) {
  dbg('ui', `updateDataMetaPill: exportedAt=${exportedAt}`);
  lastExportedAt = exportedAt;
  refreshDataMetaPillRelative();
}

function refreshDataMetaPillRelative() {
  const wrap = document.getElementById('topbar-data-meta');
  const pill = document.getElementById('data-updated-pill');
  if (!wrap || !pill) return;
  if (!lastExportedAt) {
    wrap.hidden = true;
    pill.textContent = '';
    return;
  }
  const d = new Date(lastExportedAt);
  const valid = !isNaN(d.getTime());

  pill.classList.remove('stale', 'very-stale');
  if (!valid) {
    pill.textContent = `Data updated: ${lastExportedAt}`;
    pill.title = lastExportedAt;
    dbgWarn('ui', `data-updated pill: invalid timestamp "${lastExportedAt}", showing raw text`);
  } else {
    pill.textContent = `Data updated ${formatRelative(d)}`;
    pill.title = `Snapshot generated: ${d.toLocaleString()}`;
    const days = (Date.now() - d.getTime()) / 86_400_000;
    let ageClass = 'fresh';
    if (days > 30) { pill.classList.add('very-stale'); ageClass = 'very-stale'; }
    else if (days > 7) { pill.classList.add('stale'); ageClass = 'stale'; }
    dbg('ui', `data-updated pill: "${pill.textContent}" (age ${days.toFixed(2)} days, class=${ageClass})`);
  }
  wrap.hidden = false;
}

function formatRelative(date) {
  const now = Date.now();
  const ms = now - date.getTime();
  if (ms < 0) return date.toLocaleDateString();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk} week${wk === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

