'use strict';

// ==========================================================================
// 15-utils.js — showToast, escapeHtml, escapeAttr, debounce — small reusable helpers
// ==========================================================================

// ============================================================================
// 15. Toast / utilities
// ============================================================================

let toastTimer = null;
function showToast(message, kind = 'info') {
  dbg('ui', `toast (${kind}): ${message}`);
  const toast = document.getElementById('toast');
  if (!toast) {
    dbgWarn('ui', 'showToast: #toast element not found');
    return;
  }
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) { return escapeHtml(s); }

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
