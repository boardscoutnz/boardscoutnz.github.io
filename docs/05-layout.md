
## Layout & responsiveness

- Title block uses a nested `.title-text` wrapper around `<h1>` so the
  "by Gavin McGruddy" credit sits underneath without breaking flex
  alignment of the logo.
- Mode toggle (`Board Games` / `Expansions`) sits between title and stats,
  segmented-control style. Mutually exclusive. Switching mode clears
  region/subcat selections and rebuilds the dropdowns (option set differs
  between halves).
- Topbar wraps via base `flex-wrap: wrap`; media queries at 900px and 700px
  shrink and then re-stack the sidebar below the table.
- The "NEW listings only" button is a full-width sidebar control at
  the very top of the filter column. Inactive (NEW Listings only) = red;
  active (Show ALL Listings) = green. v1.6.20 flipped the colour mapping
  so the default-state red telegraphs "high-attention filter" and the
  active green telegraphs "filter relaxed, all listings shown". The
  active state deliberately keeps the red-tinted box-shadow to keep the
  visual link to the inline NEW pills on title cells.

---
