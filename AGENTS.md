# AGENTS.md

## Cursor Cloud specific instructions

### What this is
A single static website (no backend, no build step, no package manager) that generates a weekly Hebrew Shabbat bulletin for the "Beit Menachem" synagogue. Entry point is `index.html` at the repo root; app logic is vanilla ES modules under `js/`, styles in `css/`, cached data in `data/`. See `README.md` (Hebrew) for the product overview.

### Running it
- Serve the repo root as static files, then open the printed URL. Any static server works, e.g. `python3 -m http.server 8000` or `npx --yes serve .` (README default). Opening via `file://` will NOT work — the app uses ES modules + `fetch`, which require an HTTP origin.
- There are no dependencies to install and no lockfile/`package.json`. There is no build, lint, or test tooling configured in this repo.

### Live data / egress
- On load the app fetches Shabbat times live from the Hebcal API (`https://www.hebcal.com/...`), so outbound HTTPS egress is required for real times. If Hebcal is unreachable it falls back to the cached `data/week.json`, so the page still renders.
- `scripts/seed-week.mjs` (Node 18+, uses only built-ins + global `fetch`) regenerates `data/week.json`. It overwrites that file, so restore it (`git checkout -- data/week.json`) afterward if you don't intend to commit a refresh.

### Edit mode (testing caveat)
- The "מצב עריכה" (edit mode) button opens a native `prompt()` for the password (default `menachem`). Browser-automation tooling generally cannot interact with native JS dialogs, so a click may appear to "do nothing" — this is a tooling limitation, not an app bug.
- To exercise edit mode in automated/manual UI testing without the native dialog, pre-unlock the session first: `sessionStorage.setItem('beit-menachem:editUnlocked','1')`, then trigger the real handlers by element id (e.g. `document.getElementById('btn-edit').click()`, `btn-add-message`, `btn-save`). Edits and messages persist in `localStorage`.
