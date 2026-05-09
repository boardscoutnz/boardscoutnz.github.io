'use strict';

// ==========================================================================
// 14-help.js — Help (about) modal + first-time grid hint dismiss
// ==========================================================================

// ============================================================================
// 14. Help modal + grid hint
// ============================================================================

function wireHelpModal() {
  const modal = document.getElementById('help-modal');
  const btnHelp = document.getElementById('btn-help');
  const btnClose = document.getElementById('help-close');
  btnHelp.addEventListener('click', () => {
    dbg('ui', '[event] Help (?) button clicked — opening modal');
    modal.showModal();
  });
  btnClose.addEventListener('click', () => {
    dbg('ui', '[event] Help modal close button clicked');
    modal.close();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      dbg('ui', '[event] Help modal backdrop clicked — closing');
      modal.close();
    }
  });
}

function wireGridHint() {
  const HINT_KEY = 'bsnz-hint-dismissed';
  const hint = document.getElementById('grid-hint');
  const dismiss = document.getElementById('dismiss-hint');
  if (!hint || !dismiss) {
    dbgWarn('ui', 'wireGridHint: grid-hint or dismiss-hint element not found');
    return;
  }
  try {
    const dismissed = localStorage.getItem(HINT_KEY) === '1';
    if (dismissed) {
      hint.style.display = 'none';
      dbg('ui', 'wireGridHint: hint already dismissed in a previous session — hidden');
    } else {
      dbg('ui', 'wireGridHint: hint visible (not previously dismissed)');
    }
  } catch (e) {
    dbgWarn('ui', 'wireGridHint: localStorage read threw — assuming hint visible:', e.message);
  }
  dismiss.addEventListener('click', () => {
    dbg('ui', '[event] Grid hint dismissed');
    hint.style.display = 'none';
    try { localStorage.setItem(HINT_KEY, '1'); }
    catch (e) { dbgWarn('ui', 'localStorage write threw, dismissal won\'t persist:', e.message); }
  });
}

