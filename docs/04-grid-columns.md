
## Grid columns (left → right)

`TradeMe Listing | BGG Entry | Price | Sale | Cond. | Region | BGG Rank | BGG Rating`

Hidden by default: `Weight`, `Players`, `Time` (no data in csv-only builds).

- **TradeMe Listing** — hyperlink to TM in new tab. NEW badge prefix when
  `isNewListing === true`. `widthGrow: 4`.
- **BGG Entry** — hyperlink to BGG. Prefixed with match-confidence icon:
  green ✓ exact / blue ~ fuzzy / orange ? uncertain. Icon has
  `flex-shrink: 0` so it stays a circle when text overflows. `widthGrow: 2`.
- **Region** — `widthGrow: 2`.
- **BGG Rank / Rating** — custom direction-aware sorter forces nulls to
  the bottom regardless of asc/desc. Without this the default `'number'`
  sorter scattered nulls inconsistently.

---
