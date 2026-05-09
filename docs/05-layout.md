
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
  the very top of the filter column. Inactive = neutral grey; active = red
  to match the inline NEW pills on title cells. Label flips to "🆕 Showing
  NEW only — click to show all" when active.

---
