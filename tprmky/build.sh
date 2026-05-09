#!/usr/bin/env bash
#
# tampermonkey/build.sh — assemble tm-bgbf-src/*.js into tm-bgbf.user.js
#
# Run this from the project root after editing any file in
# tampermonkey/tm-bgbf-src/. It concatenates them in numeric order
# (00-header.js → ... → 99-footer.js) and overwrites tm-bgbf.user.js.
#
# Then in Tampermonkey: dashboard → tm-bgbf userscript → "+" tab →
# paste the contents of the rebuilt tm-bgbf.user.js, save. Or, if you
# install via "Install from URL" pointing at the GitHub raw URL of
# tm-bgbf.user.js, just push and click "Check for updates".
#
# Why a build step?
# -----------------
# Tampermonkey can ONLY install a single .user.js file. The split into
# tm-bgbf-src/*.js is purely for source-code maintainability — keeps each
# logical section small enough that Claude can regenerate one file at a
# time without rewriting the whole 2,000-line script.
#
# Why a single shared IIFE?
# -------------------------
# The original userscript is one `(function () { 'use strict'; … })();`
# closure. Keeping that closure intact preserves all internal function
# scope and avoids polluting the page's global. The split files cooperate
# to reproduce that structure: 00-header.js opens the IIFE, every
# numbered file in between is body content, and 99-footer.js closes it.
# Each individual source file is therefore NOT independently valid JS —
# only the assembled output is. That's fine; the assembled output is the
# only thing the runtime ever sees.

set -euo pipefail

# Locate ourselves: build.sh lives in tampermonkey/, so the source dir
# is right next to it and the output goes one level up + back into here.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$HERE/tm-bgbf-src"
OUT_FILE="$HERE/tm-bgbf.user.js"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: source directory not found: $SRC_DIR" >&2
  exit 1
fi

# Sort by filename so 00- comes first, 99- last, and numeric prefixes
# in between order naturally (10 sorts after 09 due to the leading zero).
mapfile -t SRC_FILES < <(cd "$SRC_DIR" && ls *.js | sort)

if [[ ${#SRC_FILES[@]} -eq 0 ]]; then
  echo "ERROR: no .js source files found in $SRC_DIR" >&2
  exit 1
fi

echo "Assembling ${#SRC_FILES[@]} source files into $OUT_FILE…"
> "$OUT_FILE"
for f in "${SRC_FILES[@]}"; do
  printf '  %s\n' "$f"
  cat "$SRC_DIR/$f" >> "$OUT_FILE"
done

LINES=$(wc -l < "$OUT_FILE" | tr -d ' ')
SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo
echo "✓ Wrote $OUT_FILE ($LINES lines, $SIZE bytes)"
echo
echo "Next step: install/refresh the script in Tampermonkey."
