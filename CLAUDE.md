@AGENTS.md

# MD-08 Local Map — notes for whoever works on this next

Congressional App Challenge 2026 entry. An interactive map of the DMV that
finds small, independent businesses and splits them by congressional
district. The demo uses Maryland's 8th district (Rep. Jamie Raskin).

Team project. Conrad does most of the build. Teammates edit `ideas.txt` and
`prompt.md` directly on GitHub, so **pull before editing and never overwrite
those two files.** Our own planning notes live in `docs/baseline-notes.txt`.

**Keep this file current.** Every change to the project adds a dated entry
to the Log at the bottom: what changed, why, and any numbers measured. If a
change makes a rule or fact above the Log wrong, fix that section too.

## Scope

- **Whole area:** every congressional district in DC, Maryland and Virginia
  (20 districts: DC 1, MD 8, VA 11).
- **Built first:** the 9 DC-metro districts — DC-AL, MD-04, MD-05, MD-06,
  MD-08, VA-07, VA-08, VA-10, VA-11. "Metro" means at least 25% of the
  district's area is inside the Census Washington metro area (CBSA 47900).
  Computed in `pipeline/fetch/districts.py`, not hand-picked.
- **Demo:** MD-08.

## What counts as a small business

1. **Drop big chains:** anything with an OSM `brand` or `brand:wikidata` tag,
   plus the Name Suggestion Index chain list.
2. **Two or fewer locations in the whole US**, not just in the district. A
   national chain can have only one store inside an area; counting by name in
   Montgomery County alone let 419 chain stores through (Costco, KFC, Ace
   Hardware...).

**Deciding whether two places are the same business:**

- **Strong (any one = same business):** same website (the full site, not a
  shared host like facebook.com, Squarespace, Toast, Yelp, linktr.ee), same
  email, same Instagram/Facebook handle, same OSM `operator`.
- **Phone is one-way.** Same phone = same business. Different phones prove
  nothing, because each location has its own line.
- **Unclear cases only:** compare menus and logos. Both need scraping. Site
  builders give unrelated shops the same template logo, so a logo match alone
  never drops a business.
- **Never enough alone:** name, category, cuisine, opening hours.
  ("Golden Dragon" exists in 50 towns, all unrelated.)
- **No strong signal = different businesses.** Better to wrongly keep a
  three-location business than to wrongly drop a family shop.

## Constraints that will break things if ignored

**District lines are the Census 119th Congress boundaries.** Virginia voters
approved a mid-decade redraw in April 2026, but the state Supreme Court struck
it down in May. Maryland's Senate refused to take up a new map. If either state
redraws, update `DISTRICTS_URL` in `pipeline/fetch/districts.py` and rerun the
pipeline. Nothing else hardcodes district shapes.

**Overpass (the OSM query API) is shared and fragile.**
- Requests without a descriptive `User-Agent` get `406 Not Acceptable`.
- Big queries get `504 Gateway Timeout` when the server is busy.
- `pipeline/fetch/businesses.py` sends a User-Agent, retries, falls back to
  mirror servers, waits between queries and caches every response in
  `data/raw/osm/`.
- The site must never query Overpass live. It reads files the pipeline built.

**Use the right OSM API for each job** (none needs an API key; reference:
publicapis.io/open-street-map-api):
- **Bulk business data → Overpass.** Pipeline only, never from the site.
  A few hundred moderate queries a day on public servers.
- **Address search → Nominatim.** Max 1 request per second, descriptive
  User-Agent, no bulk geocoding. OK for a search box on the site.
- **Map display → Leaflet or MapLibre with OSM tiles.** The public tile
  server is for light use: fine for the demo, switch to a tile provider
  (MapTiler, Thunderforest) if real traffic comes.
- **"Add a missing business" → editing API v0.6** at api.openstreetmap.org.
  Needs OAuth 2.0 (`write_api` scope, `Authorization: Bearer <token>`).
  Never use it for bulk reads: its bounding-box size is capped.
- **Attribution is required** by the ODbL licence: show
  "© OpenStreetMap contributors" on the map.

**Next.js 16 is newer than most training data.** Read
`node_modules/next/dist/docs/` before writing app code (see `AGENTS.md`).
`next dev` rewrites the block in `AGENTS.md`; this file is left alone.

## Layout

- `app/`, `components/`, `features/`, `lib/`, `hooks/`, `types/`: Next.js
  site (App Router, TypeScript). Folder plan from `prompt.md`.
- `pipeline/`: offline Python data jobs. Not part of the site.
  - `fetch/districts.py`: district boundaries → `data/processed/districts.geojson`
  - `fetch/businesses.py`: OSM businesses per district → `data/processed/businesses.geojson`
  - `filter/chains/filter_chains.py`: layer 1 chain filter → `data/processed/businesses_layer1.geojson`
  - `filter/national`, `filter/matching`: layers 2 and 3 (not built yet)
- `data/raw/`: downloads and caches, git-ignored. `data/processed/`: pipeline
  output, committed.

## Running

```
npm install && npm run dev                      # site at localhost:3000
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/fetch/districts.py    # boundaries
.venv/bin/python pipeline/fetch/businesses.py   # metro districts; --all for all 20
```

## Measured facts

| thing | measurement |
|---|---|
| OSM businesses, all of Montgomery County (shop, craft, food and drink) | 3,747 |
| of those with a brand tag (chains) | ~1,300 |
| two or fewer locations by name, no brand tag | ~2,180 |
| places with no name (can't be counted) | 188 |
| businesses missing `addr:city` | about half |

OSM coverage is partial: the real number of businesses is far higher. That is
why "add a missing business" is a core feature, not an extra.

## Log

- **2026-10-01:** Picked the project: an MD-08 map of small businesses, built
  on OpenStreetMap. Tested the "two or fewer locations" rule on Montgomery
  County (numbers above) and found the chain leak, which led to the two-layer
  filter. Branch `initial-setup`: Next.js 16 skeleton, empty folders from
  `prompt.md`, `pipeline/`, `.vscode` debug configs (optional, not
  required). Lint, build and dev server checked.
- **2026-10-02:** Scope widened to all of DC/MD/VA, metro districts first,
  MD-08 for the demo. Confirmed the current district lines (see Constraints).
  Added `pipeline/fetch/districts.py`: 20 districts, 9 metro. Metro overlap:
  MD-04, MD-08, VA-08, VA-10, VA-11, DC 100%; MD-05 47%; VA-07 44%; MD-06 36%;
  VA-06 6% (not metro). Added `pipeline/fetch/businesses.py`. The first run
  hit a 504, so it now retries and falls back to mirror servers. Started this
  file.
- **2026-10-02 (cloud run):** (a) Added the OSM API usage section (which API
  for which job), using publicapis.io/open-street-map-api as the reference.
  (b) Finding: the earlier Overpass errors were 504 Gateway Timeout because
  the shared server was busy, not rate limiting (the status page showed 4 of
  4 query slots free, no 429 errors). (c) Moved the pipeline run to a cloud
  agent so it could finish while Conrad's laptop was closed. (d) What
  happened: `districts.py` re-downloaded the Census files and matched the
  committed file (20 districts, 9 metro). `businesses.py` could **not** pull
  data: every connection to the Overpass servers (`overpass-api.de`,
  `overpass.kumi.systems`) was reset or timed out, even for the tiny
  `/api/status` request, so this looks like a block in the cloud
  environment's network policy, not a busy server. No business data was
  fetched, so the chain filter and false-positive check were not run and no
  counts exist yet. Fix: in the cloud environment settings, set Network
  access to a broader level or add the Overpass hosts to the allowed
  domains, then rerun steps 3 to 5.
