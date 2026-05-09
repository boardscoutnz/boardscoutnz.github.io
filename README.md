# Board Scout NZ

**Single-user personal browser tool.** Joins a static Trade Me board-game
listings snapshot to a static BoardGameGeek rankings cache in a
sortable, filterable grid. Public repo, not a service — built by
Gavin McGruddy, for himself.

Live site: **[boardscoutnz.github.io](https://boardscoutnz.github.io)**

Two Tampermonkey companion scripts handle data acquisition; the website
only ever reads the static JSON files committed to `data/`. There is no
in-browser upload path.

---

## Repository layout

```
.
├── index.html              built artefact; do NOT edit by hand
├── README.md               this file
├── site.webmanifest        PWA manifest
│
├── components/             HTML body fragments + build.sh (assembles ../index.html)
├── css/                    stylesheets (12 logical files, auto-loaded)
├── js/                     application JS (15 modules + app.js master, auto-loaded)
├── tprmky/                 the two Tampermonkey userscripts and their sources
└── docs/                   project documentation (start with Project_Overview.md)
```

The only files at the repository root are `index.html`, this `README.md`,
and `site.webmanifest`. Everything else lives in a folder.

## Where to look

- **Project overview & architecture**: [`docs/Board_Scout_NZ___Project_Overview.md`](docs/Board_Scout_NZ___Project_Overview.md). It indexes 12 topic files in `docs/`.
- **Bug in the website**: it's almost certainly in one of `js/*.js`, `css/*.css`, or a `components/*.html` fragment. Topic files in `docs/` map subsystems to source files.
- **Bug in the data acquisition**: see `tprmky/` and `tprmky/README.md`.

## Editing the website

Source-of-truth files:
- `js/01-debug.js` … `js/15-utils.js`, plus the master `js/app.js`
- `css/01-base.css` … `css/12-responsive.css`
- `components/01-head.html` … `components/07-cdn-scripts.html`

After editing any HTML component (or after adding a new JS / CSS file
which the build picks up automatically by globbing the `js/` and `css/`
folders), rebuild `index.html`:

```bash
bash components/build.sh
```

Then commit the touched source files together with the regenerated
`index.html`.

JS and CSS files are loaded directly by `index.html`; you do not need to
rebuild after editing only a `js/*.js` or `css/*.css` file. (Reload the
browser tab and the change is live.) The build is only required when:

- you add or remove a file in `js/` or `css/`, OR
- you change anything inside `components/`.

## Editing the userscripts

`tprmky/tm-bgbf.user.js` is assembled from the source pieces in
`tprmky/tm-bgbf-src/`. Edit the relevant piece, then run:

```bash
bash tprmky/build.sh
```

`tprmky/bgg-ranks-exporter.user.js` is a single file — edit it
directly, no build step. See `tprmky/README.md` for both workflows.

## Local development

The site uses `fetch()` to load `data/listings.json` and
`data/bgg-cache.json`, so opening `index.html` directly via `file://`
will not work. Serve the directory over HTTP — for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## License

Personal project. Code shared publicly so others can take ideas from it,
but no support, warranty, or contribution process is offered.
