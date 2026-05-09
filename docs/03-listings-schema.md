
## Listings export schema (TM userscript v0.7.12, schemaVersion 7)

Per-row shape after `slimListingForExport`:

```
listingId, title, subcat, condition, isExpansion, isNewListing,
priceNumeric, priceDisplay, priceLabel, hasBuyNow, region, url
```

Wrapper:
```json
{
  "version": "0.7.12",
  "schemaVersion": 7,
  "exportedAt": "...",
  "reason": "manual|sample|...",
  "stats": { "listings": N },
  "listings": [...],
  "meta": [...]
}
```

A bare-array shape is still accepted (legacy). If `exportType === 'delta'`
the app refuses to render — a full snapshot is required.

`isNewListing` flags listings first seen during the most recent run (i.e.,
listingIds not present in IndexedDB before this run). Website renders these
with a red NEW badge prefixing the title and exposes a sidebar toggle button
to filter to NEW-only.

`isExpansion` is set by the userscript's `detectIsExpansion()` and powers
the Board Games / Expansions mode toggle. Legacy snapshots without the
field default to `false` (treated as base games).

`lastSeenAt` (added v0.7.12) is **IndexedDB-only — NOT in the export**.
Used by the userscript's reap-and-dedup pass; no website-side reader.
schemaVersion stayed at 7 because the user-facing export shape is unchanged.

**Removed fields (don't re-add without updating both ends):**
`isAccessory` (v0.7.11), `isClassified` / `district` / `suburb` (v0.7.9),
`endDate` / `closed` (v0.7.10), `firstSeen` / `lastSeen` / `pictureHref`
(v0.7.10), `memberId` / `nickname` / `classification` (Personal/Business
classifier removed in v0.7.7).

---
