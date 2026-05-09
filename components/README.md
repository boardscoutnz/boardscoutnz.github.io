# HTML components

Body fragments that are assembled by `build.sh` into the top-level
`index.html` that GitHub Pages serves.

The structural skeleton (`<!DOCTYPE>`, `<html>`, `<head>`, `<body>`,
`<main>`) lives inside `build.sh`. Each fragment in this folder
contributes one logical block of the page.

## Why a build step?

Same reason as `tprmky/build.sh`: this folder holds source-of-truth
fragments, and the served `index.html` is the assembled artefact. This
keeps each fragment small and editable in isolation, and means adding a
new JS module or stylesheet is automatic — `build.sh` globs `../js/`
and `../css/` and emits the script and link tags itself.

## Components

| File | Where it goes in index.html |
|------|------------------------------|
| `01-head.html`         | Inside `<head>`. Contains gtag analytics, `<meta>` tags, the Tabulator CDN stylesheet link, favicons, manifest link, theme-color. The auto-generated `<link rel="stylesheet">` tags for everything in `../css/` are appended by `build.sh` after this content. |
| `02-topbar.html`       | Top of `<body>`. The `<header class="topbar">` block: brand, mode toggle, stats badge, data-updated pill, action buttons. |
| `03-sidebar.html`      | Inside `<main class="layout">`. The `<aside class="sidebar">` block: filter rail (condition, search, price, region, subcat, BGG section, reset). |
| `04-content.html`      | Inside `<main class="layout">`, after the sidebar. The `<section class="content">` block: empty-state message and grid container. |
| `05-help-modal.html`   | After `</main>`. The `<dialog id="help-modal">` block. |
| `06-toast.html`        | After the help modal. The single `<div id="toast">`. |
| `07-cdn-scripts.html`  | Near the end of `<body>`. The two `<script>` tags for Tabulator and Fuse.js. The auto-generated `<script defer>` tags for `../js/*.js` are appended after this by `build.sh`. |

## What `build.sh` does

1. Globs `../css/*.css` (alphabetical) → emits `<link rel="stylesheet">` per file.
2. Globs `../js/*.js` (alphabetical, with `app.js` forced last) → emits `<script defer>` per file.
3. Reads the seven fragments above in numeric order.
4. Wraps everything in `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `<main>`.
5. Writes `../index.html`.

## Adding a new component

If the new fragment is a new section of the page (a new sidebar
section, a second modal, etc.), the simplest path is:

1. Create `components/NN-name.html` with whatever number slots between
   the relevant existing files.
2. Edit `build.sh` to read it at the right spot in the body.
3. Run `bash build.sh`.
4. Commit the new fragment, the changed `build.sh`, and the rebuilt
   `index.html` together.

If you only need to extend an existing section (a new sidebar field,
say), edit the relevant existing fragment directly — no `build.sh`
change needed; just rebuild.

## Workflow

```
edit components/03-sidebar.html
bash components/build.sh
# inspect index.html in browser
git add components/03-sidebar.html index.html
git commit
```
