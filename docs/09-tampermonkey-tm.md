
## Tampermonkey companion 1: TM collector (`tm-bgbf.user.js` v0.7.15)

Runs at `https://www.trademe.co.nz/*`. ~2560 lines. Pipeline: menu click →
build URL list (8 categories × 2 conditions = 16 passes, **shuffled per
run** in v0.7.14) → polite fetch (triangular-ish per-call distribution
around a preset-dependent mean, with occasional "human pauses" partially
refunded across the next few sleeps; rotating Accept / Accept-Language
headers; 4 retries with multiplicative-jitter exp backoff. All timing
numerics vary by active preset — see `CRAWL_SPEED_PRESETS` in
`01-constants.js`) → extract (3 fallback methods:
`__NEXT_DATA__` JSON → Next.js Flight stream → DOM cards) → normalise →
blacklist filter + expansion tag → save to IndexedDB → `reapAndDedup` →
auto-export `listings.json` (always) plus optionally `listings-example.json`
(only when the panel checkbox "Also export listings-example.json (sample)"
is ticked — defaults off, persisted across sessions via GM_setValue).

Two regexes drive title classification:

- **`PURGE_TITLE_RX`** — built from `PURGE_TITLE_KEYWORDS` (~390 banned
  words; v0.7.14 added Chutes/Shooters and Ladders variants, more
  conversation/dating-deck tokens, more bulk-quantity tokens, and a
  cluster of misc novelty/non-board-game listings — see the inline
  v0.7.14 comments in `01-constants.js`). Matched titles are dropped
  at normalise time and never reach
  the export. Includes the former accessory keywords (Dragon Shield, Card
  Sleeve, Folded Space, Gamegenic, Ultra Pro, etc.) folded in for v0.7.11.
- **`EXPANSION_TRIGGER_RX`** + **`BASE_GAME_QUALIFIER_RX`** (used by
  `detectIsExpansion`) — see below.

### Crawl-speed preset slider (v0.7.15)

The Shadow-DOM control panel includes a 3-position snap slider — **Fastest
/ Balanced / Safest** — directly under the Quick Run / Full Fetch buttons.
**Fastest** preserves v0.7.14 timing exactly (the upgrade default).
**Balanced** runs ~1.75× slower with wider jitter and more frequent
human-pause injections. **Safest** runs ~3.5× slower with the widest
jitter and longest pauses, intended for use after a TM rate-limit warning
or for runs outside normal hours. The active key is persisted via
`GM_setValue('crawlSpeedPreset')` and read at use-time by `politeSleep()`
(in `04-utilities.js`) and by the `fetchHtml` retry-backoff (in
`07-network.js`), so a mid-crawl switch affects every subsequent request
— in-flight `await sleep(…)` calls are not retroactively shortened or
extended. All numeric values live in `CRAWL_SPEED_PRESETS` in
`01-constants.js`.

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

**v0.7.13 overflow short-circuit.** Trade Me re-renders the last real
page's listings (or a stale shell) for any page number past the real
end — same ~739 KB body returned for pages 30+ when the real content
ends at page 29, etc. The `if (!listings.length) break;` end-of-list
test does NOT trip on these because TM still hands back a non-empty
listings array. To avoid wasting ~20 fetches per overflowed pass,
both `runQuickRun` and `runFullFetch` track a per-pass `seenInPass`
set and break out of the page loop when **two consecutive pages**
contain only listing IDs already stamped earlier in the same pass.
Two pages, not one, to absorb a transient TM hiccup. The reap
invariant is preserved: a page is only counted as "all repeats" if
every one of its listings was already `lastSeenAt`-stamped on a
previous page of THIS pass — so no actually-active listing goes
un-stamped, and the post-run stale reap remains safe. The faster
`if (!listings.length) break;` path is preserved as the primary
end-of-pagination signal for cases where TM does the right thing.

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
