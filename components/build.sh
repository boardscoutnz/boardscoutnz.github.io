#!/usr/bin/env bash
#
# components/build.sh — assemble index.html from components/*.html.
#
# Run this from any working directory after editing any file in
# components/. It produces ../index.html (the deployable file served
# by GitHub Pages).
#
# What it does
# ============
# 1. Reads the seven structural fragments in components/ in numeric order
#    (01-head.html, 02-topbar.html, ...).
# 2. Auto-globs ../css/*.css and emits a <link rel="stylesheet"> tag per
#    file (alphabetical order — the leading-zero numbering keeps the
#    cascade sensible).
# 3. Auto-globs ../js/*.js and emits a <script defer> tag per file in
#    alphabetical order, with the master `app.js` forced to LAST so its
#    runtime sanity-check sees every export already defined.
# 4. Wraps the result in the structural HTML scaffolding (<!DOCTYPE>,
#    <html>, <head>, <body>, <main>) and writes ../index.html.
#
# Why a build step?
# =================
# Same reason as tprmky/build.sh: components/ holds source-of-truth
# fragments, and the served index.html is the assembled artefact. Adding
# a new module (js/16-X.js) or stylesheet (css/13-X.css) requires only:
#   1. Create the file
#   2. Run this script
#   3. Commit both the new file and the updated index.html
# No edit to index.html itself, no script-tag list to maintain in two
# places.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
COMPONENTS_DIR="$HERE"
CSS_DIR="$ROOT/css"
JS_DIR="$ROOT/js"
OUT_FILE="$ROOT/index.html"

if [[ ! -d "$CSS_DIR" ]]; then
  echo "ERROR: css directory not found: $CSS_DIR" >&2
  exit 1
fi
if [[ ! -d "$JS_DIR" ]]; then
  echo "ERROR: js directory not found: $JS_DIR" >&2
  exit 1
fi

# Auto-glob CSS in alphabetical order.
mapfile -t CSS_FILES < <(cd "$CSS_DIR" && ls *.css 2>/dev/null | sort)
# Auto-glob JS in alphabetical order, force app.js last.
mapfile -t JS_NUMBERED < <(cd "$JS_DIR" && ls *.js 2>/dev/null | grep -v '^app\.js$' | sort)
JS_FILES=("${JS_NUMBERED[@]}")
if [[ -f "$JS_DIR/app.js" ]]; then
  JS_FILES+=("app.js")
fi

echo "Assembling index.html…"
echo "  components : ${COMPONENTS_DIR}"
echo "  css files  : ${#CSS_FILES[@]}"
echo "  js files   : ${#JS_FILES[@]} (app.js forced last)"
echo "  output     : $OUT_FILE"
echo

# ---------------------------------------------------------------------------
# Helper: read a component, error if missing.
read_component () {
  local name="$1"
  local path="$COMPONENTS_DIR/$name"
  if [[ ! -f "$path" ]]; then
    echo "ERROR: missing component: $name" >&2
    exit 1
  fi
  cat "$path"
}

# ---------------------------------------------------------------------------
# Build the file.
{
  echo '<!DOCTYPE html>'
  echo '<html lang="en">'
  echo '<head>'
  read_component "01-head.html"

  echo '  <!-- Local stylesheets (auto-generated from css/*.css) -->'
  for css in "${CSS_FILES[@]}"; do
    printf '  <link rel="stylesheet" href="./css/%s" />\n' "$css"
  done
  echo '</head>'

  echo '<body>'
  echo
  read_component "02-topbar.html"

  echo '  <main class="layout">'
  echo
  read_component "03-sidebar.html"
  read_component "04-content.html"
  echo '  </main>'
  echo
  read_component "05-help-modal.html"
  read_component "06-toast.html"
  echo

  read_component "07-cdn-scripts.html"
  echo
  echo '  <!-- App scripts (auto-generated from js/*.js, app.js loaded last) -->'
  for js in "${JS_FILES[@]}"; do
    printf '  <script src="./js/%s" defer></script>\n' "$js"
  done

  echo '</body>'
  echo '</html>'
} > "$OUT_FILE"

LINES=$(wc -l < "$OUT_FILE" | tr -d ' ')
SIZE=$(wc -c < "$OUT_FILE" | tr -d ' ')
echo "✓ Wrote $OUT_FILE ($LINES lines, $SIZE bytes)"
