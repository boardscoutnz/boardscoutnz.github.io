
## Tampermonkey companion 2: BGG ranks exporter (`bgg-ranks-exporter.user.js` v0.2.0)

Runs at `https://boardgamegeek.com/*`. Menu opens a modal with a max-rank
input (default 5000, persisted in localStorage as `bsnz-bgg-export-max-rank`).
Pipeline:

1. `GM_xmlhttpRequest` GETs `/data_dumps/bg_ranks`, regex-extracts the first
   `.zip` link (real download on `geek-export-stats.s3.amazonaws.com`).
   Requires user signed in to BGG.
2. Download as `arraybuffer`, validate `0x50 0x4B` ("PK") signature.
3. **fflate** decompresses synchronously (NOT JSZip — `JSZip.loadAsync()`
   would never resolve in some Tampermonkey + page CSP combinations).
4. Minimal RFC-4180-ish CSV parse, resolve columns by header name.
5. Filter (`rank > 0 && rank <= maxRank`), sort by rank ASC, project to
   `{id, primaryName, rank, average}`.
6. Emit `bgg-rankings.json` and `bgg-rankings-example.json` (top 100).

---
