# Pipeline build history

Reverse-chronological audit trail of every BSNZ pipeline session that landed
code or configuration changes on main. Append one entry at the TOP for every
new Step, fix session, or chore session before merging — see the embedded
Claude Code template's "Documentation update" section. Manual-only sessions
that don't touch the repo (e.g. the Step 1 PAT generation) are not logged
here.

This file exists so any future Claude session (or the user, or a fresh chat)
can reconstruct what's been built when, what branch landed it, and which
files moved together — without rereading every commit.

## Entry format

Each entry uses the heading style and field set below. Newest entries go at
the very top, immediately after the marker line.

    ## <Title> — <YYYY-MM-DD>
    **Branch:** <branch-name>
    **Files touched:** <comma-separated relative paths, or "see commit"
    if the diff is large>
    **Behaviour delta:** 1-3 sentences in user-observable terms.
    **Follow-ups:** <known gaps / deferred work, or "None">.

Use the merge commit's author date for the ISO date. Title is "Step N — <slug>"
for numbered plan steps, or "<branch-slug>" for fix/chore sessions.

<!-- INSERT NEW ENTRIES BELOW THIS LINE -->

## feature/test-scrape-mode — 2026-05-11
**Branch:** feature/test-scrape-mode
**Files touched:** tprmky/bsnz-pipeline-src/00-config.js (VERSION 0.5.0 →
0.5.1 + header, TM_TEST_SUBCAT_SLUGS constant, test_scrape_mode in
loadConfig),
tprmky/bsnz-pipeline-src/01a-settings.js (new "Test scrape (3 subcats
only)" checkbox row above the auto-commit row in the settings dialog),
tprmky/bsnz-pipeline-src/02-tm-scraper.js (runScrapePhase derives
activeSubcats from TM_SUBCATS via test_scrape_mode + logs the active
slug list when on),
tprmky/bsnz-pipeline.user.js (rebuilt),
docs/13-pipeline-pre-merged-data.md (dashboard paragraph updated).
**Behaviour delta:** A new persistent "Test scrape (3 subcats only)"
checkbox is available in the BSNZ Pipeline settings dialog. When ticked,
runScrapePhase walks only `childrens-games`, `dice-games`, and
`word-games` instead of all 8 TM subcats — useful for fast iteration
during pipeline development. State is GM_setValue-backed and survives
Tampermonkey reloads. The checkbox landed in the settings dialog
(01a-settings.js) rather than the main panel because 01-ui.js is still
over the 500-line threshold from the prior session.
**Follow-ups:** 01-ui.js extraction (still 613 lines) remains the
outstanding follow-up from Step 6 — unchanged by this session.

## Step 6 — Matcher and manual-override UI — 2026-05-11
**Branch:** feature/pipeline-matcher
**Files touched:** tprmky/bsnz-pipeline-src/05-fuzzy-match.js (new),
tprmky/bsnz-pipeline-src/00-config.js (VERSION 0.4.0 → 0.5.0 + header),
tprmky/bsnz-pipeline-src/01-ui.js (runMatchPhase wired into Run handler;
new bsnzShowUnmatched section; 'match' branch in bsnzUpdateProgress),
tprmky/bsnz-pipeline.user.js (rebuilt),
docs/13-pipeline-pre-merged-data.md (matcher paragraph appended).
**Behaviour delta:** Run pipeline now performs the title-matching phase
after the BGG corpus refresh. Three tiers — exact byNormName, token
containment with position/order scoring (ported from js/06-matching.js),
and a Fuse.js fuzzy fallback at threshold 0.4. Results populate
BSNZ.title_to_bgg; remaining titles surface in a new "Unmatched titles"
panel section with per-row BGG-ID input + Save (validated against the
corpus), Search-BGG link, and Skip (sentinel override). Overrides
persist via GM_setValue across Tampermonkey reloads. Still no
/thing enrichment, previous-data load, merge, or commit (Step 7+).
**Follow-ups:** 01-ui.js is now 613 lines, over the 500-line threshold.
Proposed extraction: move the unmatched-titles section
(buildUnmatchedSection / renderUnmatchedRow / window.bsnzShowUnmatched —
~95 lines) into a new sibling `01c-unmatched.js` next session before
adding further UI surface in Step 7.

## fix/pipeline-header-directives — 2026-05-10
**Branch:** fix/pipeline-header-directives
**Files touched:** tprmky/bsnz-pipeline-src/00-config.js,
tprmky/bsnz-pipeline.user.js
**Behaviour delta:** Patched the userscript header that Step 3 had left
incomplete. Added @require for fflate (needed by the BGG corpus unzip in
Step 5), @connect *.amazonaws.com (signed S3 URL the BGG ranks dump
redirects to), and @connect raw.githubusercontent.com (previous-data
fetch in Step 7). Bumped VERSION 0.2.2 → 0.2.3.
**Follow-ups:** Step 5 retry blocked on this fix; will bump to 0.3.0.

## Step 4 — TM scraper module — 2026-05-10
**Branch:** feature/pipeline-tm-scraper
**Files touched:** tprmky/bsnz-pipeline-src/02-tm-scraper.js (new),
tprmky/bsnz-pipeline-src/00-config.js (TM_SUBCATS / TM_ORIGIN /
TM_MAX_PAGES_PER_SUBCAT constants),
tprmky/bsnz-pipeline-src/01-ui.js (Run-handler now calls runScrapePhase
+ bsnzUpdateProgress wiring), tprmky/bsnz-pipeline.user.js (rebuilt),
docs/13-pipeline-pre-merged-data.md (TM scraper paragraph at the bottom).
**Behaviour delta:** Run pipeline now scrapes TM listings end-to-end:
8-subcat walk with first-subcat-wins dedupe, paginates with ?page=N,
parses __NEXT_DATA__ JSON with a DOM-card fallback, emits the bsnz.json
TM-sourced field shape into BSNZ.tm_listings. Cancel button aborts
mid-run. Still no BGG / GitHub work.
**Follow-ups:** Selectors fragile; expect periodic re-tuning when TM
ships SPA changes.

## Step 3 — Userscript shell, UI, PAT storage — 2026-05-10
**Branch:** feature/pipeline-shell
**Files touched:** tprmky/bsnz-pipeline-src/00-config.js (real config
module replacing Step 2's placeholder),
tprmky/bsnz-pipeline-src/01-ui.js (new — floating panel + settings
dialog + log overlay),
tprmky/bsnz-pipeline-src/99-footer.js (new — closes the IIFE),
tprmky/bsnz-pipeline.user.js (rebuilt), tprmky/README.md
(pipeline-src module map paragraph).
**Behaviour delta:** Installing the built userscript now injects a
fixed-position panel on every Trade Me page with a Run button (gated on
PAT being set), a settings cog, a stats grid, a progress bar, and a
10-line log tail. PAT is persisted via GM_setValue, never committed.
Run handler is a placeholder logger (real phases wired in Step 4 onward).
**Follow-ups:** Step 5 pre-condition check later identified that the
Step 3 instructions in the master plan were missing `@require fflate`
and `@connect *.amazonaws.com`; addressed in fix/pipeline-header-directives.

## Step 2 — Scaffolding and data schema — 2026-05-10
**Branch:** feature/pipeline-scaffolding
**Files touched:** tprmky/bsnz-pipeline-src/00-config.js (placeholder),
tprmky/build.sh (extended to also build bsnz-pipeline-src/),
data/bsnz.json (empty schema-1.0.0 stub),
docs/13-pipeline-pre-merged-data.md (new — schema doc),
docs/Board_Scout_NZ___Project_Overview.md (added docs/13 row).
**Behaviour delta:** Repo now has the directory layout, build hook,
placeholder data file, and schema doc the rest of the pipeline plan
builds on. No userscript code yet.
**Follow-ups:** Schema later evolved to 1.1.0 (added tm_subcat field
in Step 4); see docs/13 for the current shape.
