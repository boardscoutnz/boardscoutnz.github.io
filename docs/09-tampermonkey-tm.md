
## Tampermonkey companion 1: TM collector (`tm-bgbf.user.js` v0.7.12)

Runs at `https://www.trademe.co.nz/*`. ~2060 lines. Pipeline: menu click →
build URL list (8 categories × 2 conditions = 16 passes) → polite fetch
(~800 ms delay, 4 retries with exp backoff) → extract (3 fallback methods:
`__NEXT_DATA__` JSON → Next.js Flight stream → DOM cards) → normalise →
blacklist filter + expansion tag → save to IndexedDB → `reapAndDedup` →
auto-export `listings.json` AND `listings-example.json`.

Two regexes drive title classification:

- **`PURGE_TITLE_RX`** — built from `PURGE_TITLE_KEYWORDS` (~190 banned
  words). Matched titles are dropped at normalise time and never reach
  the export. Includes the former accessory keywords (Dragon Shield, Card
  Sleeve, Folded Space, Gamegenic, Ultra Pro, etc.) folded in for v0.7.11.
- **`EXPANSION_TRIGGER_RX`** + **`BASE_GAME_QUALIFIER_RX`** (used by
  `detectIsExpansion`) — see below.

### Expansion detection (`detectIsExpansion`)

Runs AFTER `PURGE_TITLE_RX`, so it only ever fires on titles that survived
the blacklist. Sets `isExpansion: true` on the row if:

1. Title contains a standalone `Expansion` or `Expansions`
   (case-insensitive). If not → not an expansion.
2. The substring of the title BEFORE the first match contains NONE of:
   `and`, `+`, `inc`, `inc.`, `including`, `comes`. The presence of any
   of these means the listing is a **base game that bundles an expansion**,
   not an expansion-only listing — `isExpansion` stays false and it shows
   in the default Board Games view.

Examples:

| Title                                       | isExpansion | Why                       |
|---------------------------------------------|:-----------:|---------------------------|
| `Wingspan Game and European Expansion`      | false       | "and" in prefix           |
| `Catan + Seafarers Expansion`               | false       | "+" in prefix             |
| `Concordia base game inc. expansion`        | false       | "inc." in prefix          |
| `Wingspan: European Expansion`              | true        | no qualifier              |
| `Brass Birmingham Expansion Pack`           | true        | no qualifier              |

### "🧹 Re-purge existing data" menu command

Runs the blacklist + expansion classifier across the existing IndexedDB
corpus without re-fetching, so upstream changes to either keyword list or
to `detectIsExpansion` propagate to the next export. Also explicitly
strips `LEGACY_FIELDS` (`isAccessory`, `district`, `suburb`,
`isClassified`, `endDate`, `firstSeen`, `lastSeen`, `pictureHref`,
`memberId`, `nickname`, `classification`) from any record that still
carries them.

### Expiration: per-listing `lastSeenAt` reap (v0.7.12)

Every record gets `lastSeenAt: nowIso()` stamped during the forward walk,
and at the end of every Quick Run / Full Fetch the `reapAndDedup()` helper
runs two passes:

1. **Stale-listing reap** — any record whose `lastSeenAt` is older than
   `STALE_LISTING_DAYS` (default 14) is deleted. Records with no
   `lastSeenAt` field are also deleted (only happens once, on the first
   run after upgrading from v0.7.11 — they're either pre-upgrade records
   that didn't get touched this run, or genuinely expired listings
   carried over from the old broken expiration scheme).
2. **Content-based dedup** — group by
   `(title|priceNumeric|condition|region|subcat)`. Within any group with
   ≥2 entries, keep the highest `listingId` (TM IDs are monotonic, so the
   highest is the most recent relisting) and delete the rest. Catches the
   seller-pulled-and-relisted-with-new-ID case.

For the reap to identify expired listings reliably, the Quick Run forward
walk **paginates fully** — there's no early-stop on `newCount === 0` any
more. Every active listing on TM has its `lastSeenAt` refreshed on every
run, so anything that hasn't been refreshed in 14 days is overwhelmingly
likely to be gone from TM. Quick Run runtime is therefore comparable to
Full Fetch (~5–10 minutes for the full 16-pass crawl).

The bias is intentionally aggressive: a few legitimate listings buried
deep in pagination that we happened to miss is preferable to dead links
accumulating in the grid. Tune `STALE_LISTING_DAYS` lower for more
aggression, higher for more leniency.

This **replaces** the v0.7.11 tail-anchor sweep + per-pass
`currSeenByPass` / `tailByPass` / `prevSeenByPass` machinery, which
silently never ran because `extractListingsFromPage` returns
`pagesTotalEstimate=null` for every category (a separate latent bug —
the tail walk needed that estimate to know where to start). With the
lastSeenAt approach, pagination depth is irrelevant.

**Cosmetic loose end:** `runFullFetch` still declares and writes
`currSeenByPass` / `tailByPass` and persists them to
`currSeenByPass.v1` / `tailByPass.v1` in the meta store. This is
harmless dead code now (no reader anywhere) and can be pruned in a
future pass. The two IndexedDB rows can be deleted by hand from
DevTools if desired.

### Sampler

`buildListingsSample` collects up to 15 base-game + 5 expansion rows per
subcategory (≤160 rows) and emits `listings-example.json` with
`reason: 'sample'`. 1500 ms gap between the two `downloadFile` calls so
Chrome doesn't merge or block the second download.

### IndexedDB

Two stores: `STORE_LISTINGS` (keyPath `listingId`, single index on
`subcat`) and `STORE_META`. The legacy `sellers` and `overrides` stores
have been entirely dropped. `STORE_META` keys actively used:
`lastFetchAt`, `lastRunSummary`, `lastExportAt`. (`currSeenByPass.v1`
and `tailByPass.v1` are written by Full Fetch but never read — see
"Cosmetic loose end" above.)

---
