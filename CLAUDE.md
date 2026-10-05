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

## Map categories

Every small business sits in one of five groups, and the map has a tab for
each: **Food & drink, Groceries & essentials, Personal care, Services,
Shopping.** Vape shops are left out entirely (team decision for the school
demo); plain tobacco and cannabis shops stay. The map opens on **all groups**: Conrad decided against making
food the default view. Groups are assigned in
`pipeline/filter/groups/assign_groups.py`; any shop type not listed there
falls into Shopping, and any trade (`craft=*`) into Services.

## Constraints that will break things if ignored

**District lines are the Census 119th Congress boundaries.** Virginia voters
approved a mid-decade redraw in April 2026, but the state Supreme Court struck
it down in May. Maryland's Senate refused to take up a new map. If either state
redraws, update `DISTRICTS_URL` in `pipeline/fetch/districts.py` and rerun the
pipeline. Nothing else hardcodes district shapes.

**Search never calls Overpass live.** Every business name already comes
from Overpass through the pipeline; the search bar searches
`public/data/search.json` in the browser, so it is instant and keeps
working when Overpass is down.

**Routing uses the public Valhalla server** (`valhalla1.openstreetmap.de`,
run by FOSSGIS): free, no key, allows browser requests, OSM roads and
paths. Fair use only. The app re-routes at most once every 10 seconds. For
real traffic, self-host Valhalla with a DC/MD/VA extract.

**Live navigation follows Organic Maps' design**
(`libs/routing/routing_session.cpp` in organicmaps/organicmaps). Each
position update is snapped to the route line. More than 40 m off for 3
updates in a row means off route, which asks for a new route from the
current position. Within 25 m of the destination means arrived. Their C++
router can't be reused in a website: it reads only their own `.mwm` map
files. **Browsers share location only over HTTPS** (localhost is exempt),
so the hosted site must use HTTPS. Add `?demo` to the address to get a
"Simulate trip" button that moves along the route without GPS, for testing
and demo videos.

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
- **Map display → MapLibre with OpenFreeMap vector tiles** (free, no key,
  OSM data). Not OSM's standard image tiles: those have every shop and gas
  station drawn in, chains included, and image tiles can't hide single
  icons. `BusinessMap.tsx` hides every base-map point of interest except
  landmarks (parks, schools, hospitals, churches, libraries, transit...).
  The style's own highway-shield console warnings are harmless.
- **"Add a missing business" → editing API v0.6** at api.openstreetmap.org.
  Needs OAuth 2.0 (`write_api` scope, `Authorization: Bearer <token>`).
  Never use it for bulk reads: its bounding-box size is capped.
- **Attribution is required** by the ODbL licence: show
  "© OpenStreetMap contributors" on the map.

**MapLibre 6 loads its worker from a separate file.** Next.js bundles
MapLibre's main code into a chunk, so the worker's default relative URL
breaks ("Worker failed to load") and the map shows tiles but no pins or
outlines. `scripts/copy-maplibre-worker.mjs` copies the worker into
`public/maplibre/` on `npm install`, `npm run dev` and `npm run build`, and
`BusinessMap.tsx` calls `setWorkerUrl` on it. MapLibre 6 also has **no
default export**: use named imports.

**Next.js 16 is newer than most training data.** Read
`node_modules/next/dist/docs/` before writing app code (see `AGENTS.md`).
`next dev` rewrites the block in `AGENTS.md`; this file is left alone.

## Layout

- `app/`, `components/`, `features/`, `lib/`, `hooks/`, `types/`: Next.js
  site (App Router, TypeScript). Folder plan from `prompt.md`.
  - `app/page.tsx` renders `components/map/MapView.tsx`: district picker,
    category tabs, map, info panel. Opens on MD-08, all groups.
  - `components/map/BusinessMap.tsx`: the MapLibre map (browser only,
    loaded with `ssr: false`).
  - `components/business/CategoryTabs.tsx`, `BusinessPanel.tsx`: tabs with
    counts; panel with address, hours, phone, website, OSM link.
  - `components/business/SearchBox.tsx` + `lib/search.ts`: search bar over
    every business in every district, by name, street or city.
  - Directions: `hooks/useRouteSession.ts` (live navigation state: start,
    route, position, next turn, off-route rerouting, demo trip),
    `lib/routing/valhalla.ts` (route requests), `lib/routing/geometry.ts`
    (distances, snapping a position to the route), `lib/routing/format.ts`,
    `components/routing/DirectionsPanel.tsx`, `types/routing.ts`.
  - `lib/groups.ts`: tab names and pin colors. `types/business.ts`: data types.
- `public/data/`: the site's data, written by `pipeline/load/export_site_data.py`.
  `districts.geojson` (outlines) and `businesses/<district>.geojson` (one
  small file per district, MD-08 is 0.47 MB). `search.json`: every
  business name across all districts for the search bar (2 MB, 0.55 MB
  compressed), loaded only when someone clicks into the search bar.
- `pipeline/`: offline Python data jobs. Not part of the site.
  - `fetch/districts.py`: district boundaries → `data/processed/districts.geojson`
  - `fetch/businesses.py`: OSM businesses per district → `data/processed/businesses.geojson`
  - `filter/chains/filter_chains.py`: layer 1 chain filter → `data/processed/businesses_layer1.geojson`
  - `filter/groups/assign_groups.py`: drops chains, unnamed places and
    non-businesses, assigns map groups → `data/processed/small_businesses.geojson`
  - `filter/national`, `filter/matching`: layers 2 and 3 (not built yet)
  - `load/export_site_data.py`: slim per-district files for the site → `public/data/`
- `data/raw/`: downloads and caches, git-ignored. `data/processed/`: pipeline
  output, committed.

## Running

```
npm install && npm run dev                      # site at localhost:3000
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/fetch/districts.py    # boundaries
.venv/bin/python pipeline/fetch/businesses.py   # metro districts; --all for all 20
.venv/bin/python pipeline/filter/chains/filter_chains.py
.venv/bin/python pipeline/filter/groups/assign_groups.py
.venv/bin/python pipeline/load/export_site_data.py   # writes public/data/ for the site
```

## Measured facts

| thing | measurement |
|---|---|
| OSM businesses, all of Montgomery County (shop, craft, food and drink) | 3,747 |
| of those with a brand tag (chains) | ~1,300 |
| two or fewer locations by name, no brand tag | ~2,180 |
| places with no name (can't be counted) | 188 |
| businesses missing `addr:city` | about half |

**Metro districts after layer 1 (chain filter), 2026-10-02:**

| district | businesses in OSM | chains | not chains |
|---|---|---|---|
| DC-AL | 4,752 | 1,032 | 3,720 |
| MD-04 | 1,975 | 1,026 | 949 |
| MD-05 | 2,297 | 1,146 | 1,151 |
| MD-06 | 3,444 | 1,311 | 2,133 |
| **MD-08** | **2,687** | **890** | **1,797** |
| VA-07 | 4,187 | 1,637 | 2,550 |
| VA-08 | 4,172 | 1,451 | 2,721 |
| VA-10 | 3,562 | 1,484 | 2,078 |
| VA-11 | 3,662 | 1,629 | 2,033 |
| **total** | **30,738** | **11,606** | **19,132** |

Of the chains, 11,475 were caught by an OSM brand tag and only 131 by an NSI
name match. Brand tags do almost all the work; NSI catches chains that
mappers forgot to tag.

**Small businesses by map group, 2026-10-05** (chains, unnamed places and
non-businesses and vape shops removed; layer 2 not run yet):

| district | food | groceries | personal care | services | shopping | total |
|---|---|---|---|---|---|---|
| DC-AL | 1,917 | 512 | 350 | 245 | 523 | 3,547 |
| MD-04 | 355 | 110 | 121 | 108 | 140 | 834 |
| MD-05 | 360 | 146 | 128 | 131 | 177 | 942 |
| MD-06 | 733 | 234 | 228 | 239 | 381 | 1,815 |
| **MD-08** | **721** | **167** | **221** | **224** | **309** | **1,642** |
| VA-07 | 679 | 180 | 345 | 362 | 570 | 2,136 |
| VA-08 | 1,228 | 150 | 385 | 301 | 459 | 2,523 |
| VA-10 | 848 | 149 | 256 | 221 | 403 | 1,877 |
| VA-11 | 906 | 85 | 279 | 199 | 370 | 1,839 |

All 9 metro districts: 30,738 businesses → 19,132 after chains → 17,435
after unnamed → 17,250 after non-businesses → **17,155** after vape shops.

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
- **2026-10-02 (back on the laptop):** The cloud environment could not reach
  Overpass, so the download finished locally. 7 of 9 districts were already
  cached; VA-10 and VA-11 downloaded on the first try. 30,738 businesses in
  the 9 metro districts (counts in Measured facts). Ran the chain filter and
  checked its name-only (NSI) matches by hand. Three fixes:
  1. **Same kind of business.** The name match must be in the same category
     or category family. Before: an auto body shop matched The Body Shop
     (cosmetics); restaurants matched Marshalls, European Wax Center and
     Primrose School. Exact category alone was tried first and was too strict:
     it let Jersey Mike's, Wawa, Mr. Tire and Home Depot through.
  2. **Brands in our area only.** Regional NSI brands count only if they
     operate in DC/MD/VA. Before: "ABC (Hawaii)" and New England's "Market
     Basket" flagged local shops.
  3. **Generic names skipped** ("China Wok", "Joe's Pizza", "Mini Mart",
     "Lucky" and a few more): most are unrelated local shops. Layer 2 decides.
  NSI-only matches: 231 before the fixes, 131 after. Total chains 11,706
  before, 11,606 after. Committed `businesses.geojson` (19 MB) and
  `businesses_layer1.geojson` (20 MB).
- **2026-10-05:** Decided to sort businesses into five groups with a map tab
  for each (Food & drink, Groceries & essentials, Personal care, Services,
  Shopping). The map shows all groups by default, not food first. Added
  `pipeline/filter/groups/assign_groups.py`. It also removes 1,697 unnamed
  places and 185 non-businesses (empty storefronts, unknown type, malls,
  pickup points, vending machines). Result: 17,250 small businesses in the
  metro districts, 1,645 in MD-08 (table in Measured facts). Open question:
  Shopping includes about 325 tobacco, vape and cannabis shops (all legal);
  decide whether the school demo shows them. Decided the same day: drop all
  vape shops, keep tobacco and cannabis shops. Removed 95: 51 tagged
  `shop=e-cigarette` plus 44 tagged `shop=tobacco` whose names say vape
  ("Tobacco & Vape", "Vape Jungle"). 17,155 left, 1,642 in MD-08.
- **2026-10-05 (map page):** Built the first real page. MapLibre map with
  OSM tiles, all 9 metro districts outlined, the chosen district in bold,
  one pin per small business colored by group, tabs with live counts
  (All 1,642 in MD-08), and an info panel on click. Added
  `pipeline/load/export_site_data.py` to write one small data file per
  district into `public/data/`. Removed the Next.js starter page and images.
  Checked in a real browser (Playwright driving Chrome): MD-08 loads with
  1,642 pins; the Groceries tab shows only its 167; clicking a pin opens its
  panel (tested on Sunshine General Store, Brookeville); switching to VA-08
  loads 2,523. First attempt showed tiles but no pins: MapLibre 6's worker
  file did not load (see Constraints). Lint, type check and build pass.
- **2026-10-05 (search):** Added a search bar. Conrad asked for Overpass to
  return every business name and make them searchable. The names already
  come from Overpass through the pipeline, so `export_site_data.py` now also
  writes `public/data/search.json`: 17,155 names across the 9 metro
  districts. The search runs in the browser: name matches first, then
  street or city, current district preferred. Arrow keys and Enter work.
  Picking a result switches district if needed, flies to the business, rings
  its pin and opens its panel. Tested in Chrome: "beauty supply" lists 7
  matches across 3 districts; picking "#1 Beauty Supply" from MD-08 switched
  to DC and opened its panel. Also excluded the copied MapLibre worker from
  lint (it produced 1,126 warnings that were not ours).
- **2026-10-05 (base map):** Conrad noticed chains (Shell, a Walmart-style
  shopping cart) still showing on the map, though not as our pins: they
  were drawn into OSM's standard image tiles. Switched the base map to
  OpenFreeMap's "Liberty" vector style and filtered its point-of-interest
  layers down to landmarks only. Checked at the same DC block as before:
  Shell and the cart are gone; schools, churches and parks remain. The
  map is also lighter, so pins stand out more.
- **2026-10-05 (routing):** Added directions with live navigation. Looked
  through organicmaps/organicmaps first: its router (`libs/routing/`,
  bidirectional A* in `base/astar_algorithm.hpp`, live session in
  `routing_session.cpp`) is C++ for its own map files, so the app uses the
  Valhalla routing service and copies Organic Maps' live-session logic
  (constants in Constraints). The business panel has a Directions button.
  The directions panel has: start from your location or a point clicked on
  the map, Walk/Bike/Drive, time and distance, every step, Start/Stop
  navigation, and a next-turn banner. The map draws the route under the pins,
  a start marker and your position, and follows you while navigating.
  Tested in Chrome with a fake GPS position in Olney, to Sunshine General
  Store: walk 5.1 mi / 1 hr 42 min, drive 5.7 mi / 10 min; navigation shows
  the next turn; moving the fake GPS about 300 m off the route for 3
  updates made exactly 1 new route request, drawn from the new spot; the
  simulated trip moves along the route. Bug found while testing: the panel
  is a height-limited flex column, so the Walk/Bike/Drive buttons shrank to
  nothing; panel children no longer shrink.
