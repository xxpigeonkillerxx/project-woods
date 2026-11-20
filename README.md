# Project Woods · Michigan Land Freedom Atlas

Live site: https://xxpigeonkillerxx.github.io/project-woods/

A static site (no build step) served by GitHub Pages from `main`.

```
index.html          page shell
css/app.css         styles
js/config.js        status vocabularies, labels, colors, service URLs
js/data.js          loads data/*.json
js/app.js           map, panels
js/table.js         township comparison table
data/townships.json research records (public, sanitized)
data/sources.json   evidence sources
vendor/leaflet/     Leaflet 1.9.4 (BSD-2)
scripts/validate.mjs data checks (run in CI on every PR)
docs/DATA.md        field definitions and research handoff format
docs/OUTREACH.md    township email outreach workflow (drafts, reply tracking)
outreach/           question library for outreach drafts
scripts/outreach/   draft builder (contacts and drafts stay out of this repo)
```

Run locally: `python3 -m http.server` then open http://localhost:8000 (opening the file directly won't load the JSON).

Validate data: `node scripts/validate.mjs`
