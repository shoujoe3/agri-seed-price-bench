# Agri-Seed Price Bench

An illustrative agricultural seed & grain pricing simulator for **West Africa** and
**East Asia** (10 crop-markets). Built with React + Vite, deployed free on GitHub Pages.

Live site (after you deploy): `https://<your-username>.github.io/<your-repo-name>/`

---

## Part A — Put it online (one-time setup)

### 0. Install the tools (one-time, on your computer)
- **Node.js** (v20 or newer): https://nodejs.org  → verify with `node -v`
- **Git**: https://git-scm.com  → verify with `git -v`
- A free **GitHub account**: https://github.com

### 1. Create an empty repo on GitHub
- GitHub → **New repository** → name it e.g. `agri-seed-price-bench`
- Leave it empty (no README/licence). Copy the repo name — you'll need it once.

### 2. Point the build at your repo name
Open **`vite.config.js`** and set `base` to `"/<your-repo-name>/"` (keep both slashes):
```js
base: '/agri-seed-price-bench/',
```
This is the #1 thing people get wrong. If the deployed page loads blank/unstyled,
it's almost always this line not matching the repo name.

### 3. Test it locally (optional but recommended)
From this folder, in a terminal:
```bash
npm install
npm run dev
```
Open the printed `http://localhost:5173/...` link. You should see the simulator.
Press Ctrl+C to stop.

### 4. Push this project to GitHub
From this folder:
```bash
git init
git add .
git commit -m "Initial commit: seed price simulator"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

### 5. Turn on GitHub Pages (Actions mode)
- On GitHub: **Settings → Pages**
- Under **Build and deployment → Source**, choose **GitHub Actions**.
- That's it — the included workflow (`.github/workflows/deploy.yml`) builds and
  publishes automatically. Watch progress under the **Actions** tab.
- After ~1–2 minutes your live URL appears at the top of **Settings → Pages**:
  `https://<your-username>.github.io/<your-repo-name>/`

Share that URL — anyone can open and interact with it, no install needed.

---

## Part B — Make updates later

Every push to `main` redeploys automatically. The loop is:
```bash
# make your edits, then:
git add .
git commit -m "describe what changed"
git push
```
Wait ~1–2 min (see the Actions tab), refresh the site. Done.

> Tip: you can also edit files directly on github.com (pencil icon) and commit —
> that triggers the same auto-deploy, no computer needed.

---

## Part C — Adding / updating datasets

All the model's numbers live in two objects near the top of **`src/App.jsx`**:
`CROPS` and `COUNTRIES`. Updating data = editing these and pushing.

### What each crop field means
```js
wa_maize: {
  region:"WA",          // "WA" = West Africa, "EA" = East Asia
  name:"Maize", icon:"🌽",
  base:280,             // reference wholesale price, USD/tonne
  bHist:.45,            // price-momentum exponent (storage/AR persistence)
  bFx:.30,              // exchange-rate pass-through elasticity
  bInf:.60,             // inflation pass-through elasticity
  bGdp:.15,             // demand/income elasticity
  bWx:.95,              // weather->yield->price exponent (higher = more inelastic)
  kTrans:.34,           // transport-margin sensitivity (bulky/low-value = higher)
  sAmp:.18,             // seasonal amplitude (harvest trough <-> lean peak)
  harv:9,               // harvest month, 0=Jan ... 9=Oct
  vol:.11               // typical monthly volatility (for the price band)
}
```
- **Add a crop:** copy a block, give it a new key, edit the fields.
- **Recalibrate with real data:** when you estimate elasticities from a price series
  (e.g. a VECM pass-through coefficient), replace the matching `b*` value and update
  `base` with the current reference price. Note the source in a comment.
- **Add a country/market:** add an entry to `COUNTRIES` with its currency, an
  indicative USD exchange rate, and `markets: [["Name (port?)", remoteness]]`
  where remoteness is 0 (at port) → 1 (deep interior). This feeds the transport wedge.

### Optional upgrade: load data from a file instead of editing code
Good when datasets grow or non-coders will maintain them.

1. Put a JSON file in **`public/data/`** (a sample is included at
   `public/data/crops.sample.json`). Files in `public/` are served at
   `<site>/data/<file>.json`.
2. In `src/App.jsx`, load it at startup and merge into `CROPS`:
```jsx
import { useEffect, useState } from "react";

// inside App():
const [extraCrops, setExtraCrops] = useState({});
useEffect(() => {
  fetch(`${import.meta.env.BASE_URL}data/crops.sample.json`)
    .then(r => r.json())
    .then(d => setExtraCrops(d.crops || {}))
    .catch(() => {});   // ignore if file absent
}, []);
const ALL_CROPS = { ...CROPS, ...extraCrops };
```
Then use `ALL_CROPS` wherever the code currently reads `CROPS`.
Using `import.meta.env.BASE_URL` keeps the path correct on GitHub Pages.

> Keep raw source spreadsheets (CSV/XLSX) in a `/data-sources/` folder in the repo
> for provenance, and convert to the JSON the app reads. The app only needs the JSON.

---

## Project structure
```
.
├─ index.html                     # page shell
├─ vite.config.js                 # ← set `base` to your repo name
├─ package.json
├─ .github/workflows/deploy.yml   # auto-deploy on push to main
├─ public/data/                   # optional runtime datasets (served as-is)
└─ src/
   ├─ main.jsx                    # mounts the app
   └─ App.jsx                     # the simulator + all model data (CROPS, COUNTRIES)
```

## Notes
- This is a **teaching / scenario tool**. Elasticities are plausible values within
  ranges reported in the literature (see the app's References tab), not estimates
  fitted to any single market. Not price-forecasting or trading advice.
- Free hosting, public repo: anyone can view the site and the code. Don't commit
  anything private.

## Licence
Add one if you like (MIT is a common permissive choice) via GitHub → Add file → `LICENSE`.
