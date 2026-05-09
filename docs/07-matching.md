
## Matching pipeline

Most of the recent dev effort lives here. Three tiers in order; the first
hit wins. `matchTitle()` is called once per listing inside
`enrichListingsWithBgg`.

### Tier 1 — full-string exact match

`bgg.byNormName.get(normalizedTitle)`. O(1). Catches well-formed titles.

### Tier 2 — token containment with position scoring

The bulk of real matches go through here. Three pieces:

1. **`bgg.nameEntries`** — flat array of `{id, normName, tokens, rank}`,
   one per searchable name (primary + each alt). Sorted descending by
   token count.
2. **`bgg.tokenToEntryIdx`** — `Map<token, Set<entryIdx>>`. Inverted index;
   prunes ~99 % of `nameEntries` per call before any containment check.
   Single-token entries indexed only if `length ≥ MIN_SINGLE_TOKEN_LEN` (6)
   — keeps generic words ("game", "the") out, keeps specific ones in
   ("cartographers", "pandemic").
3. **Containment + scoring**:
   - Multi-token candidates: every BGG token instance must be matched by a
     distinct listing-token instance (multi-set / "bag" containment), so e.g.
     a BGG entry of "Hop! Hop! Hop!" no longer matches a listing of "Pop n
     Hop". Set semantics let three "hop" tokens all collide on a single
     listing "hop"; bag semantics correctly require three distinct ones.
     v1.6.20.
   - Single-token candidates (e.g. "Cartographers"): must additionally sit
     at **position 0** of the listing.
   - `findPositionInListing(bggTokens, listingTokens)` returns
     `{start, inOrder, contiguous}`.
   - Sort priority: **earliest position → longest BGG name → contiguous →
     in-order → better rank**. Position-first means listings starting with
     the game name win over multi-game listings (catches
     `Cartographers - A Roll Player Tale` → Cartographers, not Roll Player).
   - Hard rejection: 2-token matches that are neither contiguous nor
     in-order are dropped (catches `Wonders of the World` ≠ `World Wonders`).

### Tier 3 — Fuse.js fuzzy fallback. CURRENTLY DISABLED

`FUSE_TOP_N_LIMIT = 0`. Fuse was producing too many false positives
(matching "Board games" → "Slay the Spire: The Board Game") and accounting
for ~99 % of enrichment runtime (16 min vs. seconds without it). The wiring
stays in place — set `FUSE_TOP_N_LIMIT > 0` to re-build over the top-N
ranked games.

### Confidence labels

| Pattern                              | Confidence | Icon |
|--------------------------------------|:----------:|:----:|
| Tier 1 exact                         | exact      | ✓    |
| Tier 2 contiguous                    | exact      | ✓    |
| Tier 2 in-order, ≥4 tokens           | exact      | ✓    |
| Tier 2 single-token at position 0    | exact      | ✓    |
| Tier 2 in-order, 2–3 tokens          | fuzzy      | ~    |
| Tier 2 out-of-order, ≥3 tokens       | fuzzy      | ~    |
| Tier 2 anything else                 | uncertain  | ?    |
| 2-token out-of-order                 | rejected (no match) |

### Sentinel canonicalisation (critical, easy to miss)

Some phrases are part of game identity — `"Power Grid"` and `"Power Grid:
The Card Game"` are different games. Naively stripping `card game` collapses
the two BGG entries to the same `bgg.byNormName` key, after which Tier 1
picks one arbitrarily.

`SENTINEL_REPLACEMENTS` (in `app.js` §2) runs **before** the `NOISE_TOKENS`
strip inside `normalizeTitle` and canonicalises identity-bearing phrases
to single sentinel tokens:

```
card game / cardgame                        → cardgame
board game / boardgame                      → boardgame
1st/first edition / 2nd/second edition / …  → ed1 / ed2 / …
(also tabletop, dice, party, word, family, strategy)
```

Any phrase added to `SENTINEL_REPLACEMENTS` MUST be removed from
`NOISE_TOKENS` — leaving it there strips the sentinel back out.

### normalizeTitle pipeline order (v1.6.21)

The order of substitutions inside `normalizeTitle` is load-bearing:

1. lowercase
2. **diacritic fold** — `s.normalize('NFD').replace(/[̀-ͯ]/g,'')`
   so `Orléans` ≡ `Orleans`, `Kutná Hora` ≡ `Kutna Hora`,
   `Pâtisserie` ≡ `Patisserie`. Pure-ASCII titles are unaffected.
3. **`APOSTROPHE_RX → ''`** (no space) — strips both straight `'` and
   curly U+2018-U+201F variants. Runs BEFORE PUNCT_RX, which would
   otherwise inject a space and split `It's` into `it` + `s`. With
   apostrophe-strip first, `It's` → `Its` matches the unapostrophised
   surface form.
4. **`PAREN_GENRE_RX → ' '`** — drops bracketed clarifiers like
   `(Board Game)`, `(Card Game)`, `(Tabletop Game)`, `(Game)`,
   `(The Game)`. Runs BEFORE the sentinel pass — otherwise
   `Root (Board Game)` would canonicalise to `root boardgame` while the
   BGG entry is just `root`. Bare (non-parenthesised) `Card Game` /
   `Board Game` are still handled by `SENTINEL_REPLACEMENTS` for cases
   like `Power Grid: The Card Game`.
5. PUNCT_RX → ' ', QTY_RX → ' ', YEAR_RX → ' '
6. SENTINEL_REPLACEMENTS
7. NOISE_TOKENS strip
8. MULTISP collapse + trim

### Publisher-name pre-strip (listing side only)

`stripPublisherFromListing(title)` (in `js/06-matching.js`) removes a
single recognised publisher prefix and/or suffix from the LISTING title
before normalisation. Drives e.g. `FINCA - Rio Grande Games` → `FINCA` →
match against BGG `Finca`. Matches `MATCH_PUBLISHER_NAMES` (in §2)
case-insensitively, with optional trailing ` Games`, allowing
hyphen/colon/em-dash separators.

Listing-only — `js/05-bgg-cache.js` calls `normalizeTitle` directly on
BGG names. Stripping publishers from the BGG side would lose
distinctions for entries that legitimately start with one of these
tokens.

### Async chunked enrichment

`enrichListingsWithBgg` is `async` — processes in batches of
`MATCH_BATCH_SIZE` (250), `await`s a 0 ms `setTimeout` between batches so
the browser can repaint. Without this the page locks for the full duration
of the run. Both call sites (`ingestJson` and `loadBggCache`'s
if-listings-already-loaded branch) must `await` it.

`ingestJson` calls `showGrid()` BEFORE awaiting enrichment, so the grid
appears immediately and BGG-decorated rows are pushed in via
`table.replaceData(listings)` once enrichment finishes (followed by
`table.redraw(true)` — see Gotchas).

### Known matching limitations

- **Generic listings** (`"Star Wars Board Game"`) — undecidable from title
  alone; matcher picks the most generic 2-token BGG match.
- **Listings missing leading franchise name** (`"Jabba's Palace - A Love
  Letter Game"` should match `"Star Wars: Jabba's Palace – …"`) — will
  resolve once `alternateNames` is populated by the full pipeline.
- **Multi-game listings** (`"Dominion Rising Sun Expansion"`) — matcher
  picks the leading game (Dominion) under the position-first rule.

---
