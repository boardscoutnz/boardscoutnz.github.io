'use strict';

// ==========================================================================
// 16-rating-slider.js — dual-handle BGG rating slider sidebar control
// ==========================================================================
//
// v1.6.20: extracted from 12-filters.js to keep that file under the 500-line
// cap. The slider drives filters.bggMinRating and filters.bggMaxRating, both
// of which are cleared to null when the corresponding handle sits at its
// extreme — meaning "no rating filter active" so listings with bgg_average=
// null are not rejected. Two stacked <input type="range"> elements share a
// styled track via 04a-rating-slider.css; this file owns the wiring only.

const RATING_SLIDER_MIN_BOUND = 0;
const RATING_SLIDER_MAX_BOUND = 10;
const RATING_SLIDER_DEBOUNCE_MS = 750;

let ratingSliderDebounceTimer = null;

function ratingSliderEls() {
  return {
    track:    document.getElementById('rating-slider-track'),
    fill:     document.getElementById('rating-slider-fill'),
    minInput: document.getElementById('rating-slider-min'),
    maxInput: document.getElementById('rating-slider-max'),
    minLabel: document.getElementById('rating-min-value'),
    maxLabel: document.getElementById('rating-max-value'),
    reset:    document.getElementById('rating-slider-reset'),
  };
}

function formatRating(v) {
  return Number(v).toFixed(1);
}

function syncRatingSliderUi(els) {
  const minV = Number(els.minInput.value);
  const maxV = Number(els.maxInput.value);
  els.minLabel.textContent = formatRating(minV);
  els.maxLabel.textContent = formatRating(maxV);
  const span = RATING_SLIDER_MAX_BOUND - RATING_SLIDER_MIN_BOUND;
  const leftPct  = ((minV - RATING_SLIDER_MIN_BOUND) / span) * 100;
  const widthPct = ((maxV - minV) / span) * 100;
  if (els.fill) {
    els.fill.style.setProperty('--rating-slider-fill-left', `${leftPct}%`);
    els.fill.style.setProperty('--rating-slider-fill-width', `${widthPct}%`);
  }
}

// Map handle positions to filter-state values. At-extreme = null (no filter).
function syncRatingSliderFilters(els) {
  const minV = Number(els.minInput.value);
  const maxV = Number(els.maxInput.value);
  filters.bggMinRating = (minV <= RATING_SLIDER_MIN_BOUND) ? null : minV;
  filters.bggMaxRating = (maxV >= RATING_SLIDER_MAX_BOUND) ? null : maxV;
}

function lockRatingSlider(els, locked) {
  els.minInput.disabled = locked;
  els.maxInput.disabled = locked;
  if (els.track) els.track.classList.toggle('is-locked', locked);
}

function applyRatingSliderNow(els) {
  syncRatingSliderFilters(els);
  lockRatingSlider(els, true);
  try {
    if (typeof applyFilters === 'function') applyFilters();
  } finally {
    // applyFilters is synchronous in this codebase; the lock is essentially
    // instantaneous but guards against rapid re-entrance during a heavy
    // filter pass.
    lockRatingSlider(els, false);
  }
}

function scheduleRatingSliderApply(els) {
  if (ratingSliderDebounceTimer) clearTimeout(ratingSliderDebounceTimer);
  ratingSliderDebounceTimer = setTimeout(() => {
    ratingSliderDebounceTimer = null;
    applyRatingSliderNow(els);
  }, RATING_SLIDER_DEBOUNCE_MS);
}

function resetRatingSlider() {
  const els = ratingSliderEls();
  if (!els.minInput || !els.maxInput) return;
  if (ratingSliderDebounceTimer) {
    clearTimeout(ratingSliderDebounceTimer);
    ratingSliderDebounceTimer = null;
  }
  els.minInput.value = String(RATING_SLIDER_MIN_BOUND);
  els.maxInput.value = String(RATING_SLIDER_MAX_BOUND);
  filters.bggMinRating = null;
  filters.bggMaxRating = null;
  syncRatingSliderUi(els);
  if (els.track) els.track.classList.remove('is-locked');
  els.minInput.disabled = false;
  els.maxInput.disabled = false;
}

function wireRatingSlider() {
  const els = ratingSliderEls();
  if (!els.minInput || !els.maxInput) {
    if (typeof dbgWarn === 'function') {
      dbgWarn('init', 'wireRatingSlider: slider markup missing — skipping');
    }
    return;
  }

  syncRatingSliderUi(els);

  els.minInput.addEventListener('input', () => {
    let minV = Number(els.minInput.value);
    const maxV = Number(els.maxInput.value);
    if (minV > maxV) {
      // Cross-handle clamp: snap the just-moved handle back to the other.
      minV = maxV;
      els.minInput.value = String(minV);
    }
    syncRatingSliderUi(els);
    if (typeof dbg === 'function') dbg('filter', `[event] rating slider min → ${minV}`);
    scheduleRatingSliderApply(els);
  });

  els.maxInput.addEventListener('input', () => {
    let maxV = Number(els.maxInput.value);
    const minV = Number(els.minInput.value);
    if (maxV < minV) {
      maxV = minV;
      els.maxInput.value = String(maxV);
    }
    syncRatingSliderUi(els);
    if (typeof dbg === 'function') dbg('filter', `[event] rating slider max → ${maxV}`);
    scheduleRatingSliderApply(els);
  });

  if (els.reset) {
    els.reset.addEventListener('click', () => {
      if (typeof dbg === 'function') dbg('ui', '[event] Rating slider reset clicked');
      resetRatingSlider();
      // Explicit user action — no debounce.
      if (typeof applyFilters === 'function') applyFilters();
    });
  }
}
