@AGENTS.md

# MD-08 Local Map — notes for whoever works on this next

Congressional App Challenge 2026 entry (our district: Maryland's 8th, Rep.
Jamie Raskin). An interactive map of the DC area that finds small,
independent businesses. Businesses load for whatever part of the map is on
screen, like Google Maps; the app no longer uses district lines at all
(removed 2026-10-15).

Team project. Conrad does most of the build. Teammates edit `ideas.txt` and
`prompt.md` directly on GitHub, so **pull before editing and never overwrite
those two files.** Our own planning notes live in `docs/baseline-notes.txt`.

**Keep this file current.** Every change to the project adds a dated entry
to the Log at the bottom: what changed, why, and any numbers measured. If a
change makes a rule or fact above the Log wrong, fix that section too.

## Scope

- **Area covered:** one rectangle, `REGION` in `pipeline/fetch/businesses.py`:
  longitude -77.9 to -76.5, latitude 38.3 to 39.7. That is DC plus the inner
  Maryland and Virginia suburbs (Frederick and Columbia in the north, Leesburg
  in the west, down past Woodbridge). To cover more, widen `REGION` and rerun
  the pipeline; downloaded cells are cached and reused.
- **Demo:** the map opens on Bethesda and Rockville (MD-08 country).

## What counts as a small business

1. **Drop big chains:** anything with an OSM `brand` or `brand:wikidata` tag,
   plus the Name Suggestion Index chain list.
1b. **Our own location count** (`pipeline/filter/chains/repeat_locations.py`):
   a brand name seen 3+ times across the pulled area is a chain
   (town removed: "Kusshi Bethesda" counts as Kusshi), and so are 3+
   businesses sharing a website that contains their name. Names made only
   of generic words ("China King", "Food Mart") need the website match:
   they are usually unrelated family businesses. Catches regional chains the
   lists miss: Kusshi, Moby Dick House of Kabob, Lebanese Taverna, Matchbox.
2. **Two or fewer locations in the whole US**, not just in our area. A
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

## How the map shows businesses

Business pins are drawn the way Organic Maps draws its map (their renderer,
`libs/drape_frontend` in organicmaps/organicmaps; read 2026-10-15):

- **Same tiles as Organic Maps.** Their Mercator (x = longitude, y =
  latitude stretched, both -180..180) and their tile keys: a tile at zoom z
  is a square 360 / 2^(z-1) Mercator degrees wide, numbered from 0,0 with y
  going north (`tile_key.cpp`, `tile_utils.cpp`). Their zoom is MapLibre's
  plus one. Zoom 17 is the deepest data zoom: closer views reuse zoom-17
  tiles. We export zooms 10 to 17 (pins start at MapLibre zoom 9).
- **Each zoom holds only what it draws** (their scale index). The pipeline
  gives every business `z`, the first zoom where it is the best-described
  business in its cell (16 cells per tile side, about 32 px), and `gz`, the
  same within its own group, so a category tab zoomed out still has
  well-spread pins. A zoom-z tile holds businesses with `z` or `gz` up to z;
  zoom-17 tiles hold every business. "Best-described" is `rank`: cuisine and
  type tags, website, hours, phone, menu.
- **Screen coverage** (`ResolveTileKeys`, `CalcTilesCoverage`): on every pan
  or zoom the site works out the tiles covering the screen plus 75 px, at
  the current zoom (`lib/geo/tiles.ts`), fetches the missing ones, cancels
  requests for tiles that left the screen before arriving, and drops tiles
  that left. Tiles of the previous zoom stay on screen until every new tile
  has arrived, so zooming never blinks empty (`MapView.tsx`).
- **Collisions** are MapLibre symbols that hide when they would overlap,
  best `rank` first, like Organic Maps' overlay tree (`BusinessMap.tsx`).
  Names appear beside pins from MapLibre zoom 15. Below zoom 9 no business
  pins show, only saved spots. Saved spots are always visible.
- **Counts follow the view and count every business, not just the pins
  shown.** Tiles below zoom 17 carry counts per group and per tag for 16 x 16
  cells; the site adds the cells on screen (cells cut by the screen edge
  count by the share on screen). Zoom-17 tiles are counted business by
  business. Checked against exact counts on 160 random views: median error
  under 1%; the worst cases (up to about 30%) are small counts where a
  cluster sits on the screen edge.
- The header names the town most pins near the middle list as their city
  ("Bethesda"; "Washington, DC area" when zoomed out or no town is known).
  Outside the covered rectangle the map says "Not mapped yet". An open
  business panel stays open when its tile is dropped. Double-click zooms in.

## Map categories

Every small business sits in one of five groups, and the map has a tab for
each: **Food & drink, Groceries & essentials, Personal care, Services,
Shopping.** Vape shops are left out entirely (team decision for the school
demo); plain tobacco and cannabis shops stay. The map opens on **all groups**: Conrad decided against making
food the default view. Groups are assigned in
`pipeline/filter/groups/assign_groups.py`; any shop type not listed there
falls into Shopping, and any trade (`craft=*`) into Services.

Inside a tab, a second row of **type chips** narrows further: OSM cuisines
(Italian, Pizza, Chinese...) and OSM types (Cafe, Bakery, Hairdresser...),
most common first, with counts, then a **Features** section (Takeout,
Outdoor seating, Wheelchair accessible, Wi-Fi, Vegan, Halal...). A business
can carry several tags: a pizza restaurant is both "Pizza" and "Restaurant".
Tags are built by `pipeline/load/tagging.py` from three OSM-only sources:
cuisine and type, words in the name ("Taqueria" means Mexican; rules apply
only inside their own map group), and OSM detail tags. Chosen instead of an
AI model: no API key, instant, works offline, and can't invent businesses.

**Search puts tags first.** "pizza", "pizza place" and "chinese food" name a
tag (filler words like food/place/shop are dropped; a synonym list maps
coffee→cafe, haircut→hairdresser, take out→takeout...). Businesses with that
tag rank above name matches, and the first result is "Pizza: show all 43 on
the map", which opens the tab and chip.

**Not built yet, waiting on outside data** (team decision 2026-10-06):
average price, reviews, customer traffic. OSM has no price tags at all in
our data; reviews and per-store traffic need a service such as Google
Places, Yelp, Foursquare or BestTime.

## Look and feel

Minimal and monochrome (Conrad turned down the earlier green, 2026-10-13).
Set up with Anthropic's `frontend-design` skill (installed 2026-10-12):

- **Color only means something:** the five category pin colors
  (`lib/groups.ts`) and marigold `#f0b33c` for saved spots. Everything else
  is black, white and grays (`app/globals.css`): ink `#171717`, buttons
  `--action` black with white text, borders `#ebebeb`, muted text `#6b6b6b`.
  Dark mode flips them.
- **Base map:** OpenFreeMap "Positron", a gray style with no shop icons, so
  the pins are the only color on the map.
- **Type:** Atkinson Hyperlegible Next everywhere (made by the Braille
  Institute for low-vision readers). Bricolage Grotesque only for the
  header's place name, the one loud element.
- **Words:** plain, sentence case, from the visitor's side. No ALL-CAPS
  labels, no "A · B · C" strings; use commas. Errors say what happened and
  what to do.
- **Panels:** white sheets, hairline border, light shadow; a small colored
  dot by the type line shows the category. Business names appear beside
  pins from zoom 15 in.

## Saved spots

The heart **Save** button in a business panel keeps it in the **Saved** tab
(`hooks/useSaved.ts`). Saved spots are stored in the browser's
localStorage: no account, no server, so they stay on that device only.
Each keeps its name, type, city and position. They are drawn as their
own map layer, so they show with a marigold ring **anywhere on the map**,
even where business tiles haven't loaded. The Saved tab hides other pins,
zooms out to fit every saved spot, and lists them; clicking one flies
there. Saved is a toggle: pressing it again (or the list's ×)
returns to the previous tab.

## Constraints that will break things if ignored

**The tile scheme lives in the export.** `MIN_TILE_ZOOM`,
`MAX_DATA_ZOOM`, `THIN_CELLS` and `STAT_CELLS` in
`pipeline/load/export_site_data.py` decide the tiles; the site reads zooms,
cells and the covered area from `public/data/tiles.json`. The tile math
itself (Mercator, tile size, MapLibre zoom + 1) is in both the export and
`lib/geo/tiles.ts`: change one, change the other.

**Only filtered businesses reach the site.** The export reads
`small_businesses.geojson` (after the chain filter and `assign_groups.py`)
and stops with an error if any business in it is not marked "not a chain"
in `businesses_layer1.geojson` or has no group. Rerun the filters first.

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
- **Map display → MapLibre with OpenFreeMap vector tiles** ("Positron" style; free, no key,
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
  - `app/page.tsx` renders `components/map/MapView.tsx`: header, search,
    category tabs, map, panels; loads the business tiles on screen. Opens
    on Bethesda and Rockville, all groups.
  - `lib/geo/tiles.ts`: Organic Maps tile math: Mercator, tile zoom,
    tiles covering the screen, share of a stat cell on screen.
  - `components/map/BusinessMap.tsx`: the MapLibre map (browser only,
    loaded with `ssr: false`).
  - `components/business/CategoryTabs.tsx`, `BusinessPanel.tsx`: tabs with
    counts; panel with address, hours, phone, website, OSM link.
  - `components/business/TagFilter.tsx` + `lib/tags.ts`: type chips inside
    a category tab.
  - `components/business/SearchBox.tsx` + `lib/search.ts`: search bar over
    every business, by name, street or city; matches on screen rank first.
  - Directions: `hooks/useRouteSession.ts` (live navigation state: start,
    route, position, next turn, off-route rerouting, demo trip),
    `lib/routing/valhalla.ts` (route requests), `lib/routing/geometry.ts`
    (distances, snapping a position to the route), `lib/routing/format.ts`,
    `components/routing/DirectionsPanel.tsx`, `types/routing.ts`.
  - `lib/groups.ts`: tab names and pin colors. `types/business.ts`: data types.
- `public/data/`: the site's data, written by `pipeline/load/export_site_data.py`.
  `tiles/<z>/<x>_<y>.json` (one Organic Maps tile: GeoJSON pins plus count
  stats) and `tiles.json` (zooms, covered area, and which tiles have
  businesses, so the site never asks for an empty one). Committed with the
  site so hosting needs no pipeline run: about 7,000 small files, 43 MB. `search.json`: every business name for the search
  bar, loaded only when someone clicks into the search bar.
- `pipeline/`: offline Python data jobs. Not part of the site.
  - `fetch/businesses.py`: OSM businesses in `REGION`, one Overpass query per
    0.2° cell (cached in `data/raw/osm/cells/`) → `data/processed/businesses.geojson`.
    A cell that fails is skipped and named at the end; rerun to fill it in.
  - `filter/chains/filter_chains.py`: layer 1 chain filter → `data/processed/businesses_layer1.geojson`
  - `filter/groups/assign_groups.py`: drops chains, unnamed places and
    non-businesses, assigns map groups → `data/processed/small_businesses.geojson`
  - `filter/national`, `filter/matching`: layers 2 and 3 (not built yet)
  - `load/export_site_data.py`: checks every business passed the filters,
    ranks them, cuts Organic Maps tiles for the site → `public/data/`
  - `load/tagging.py`: tag rules, used by the export
- `data/raw/`: downloads and caches, git-ignored. `data/processed/`: pipeline
  output, committed.

## Running

Easiest: `./install.sh` (Node and Python dependencies), `./install.sh --data`
(whole data pipeline), `./run.sh` (dev server). Added by vxkxng. By hand:

```
npm install && npm run dev                      # site at localhost:3000
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/fetch/businesses.py   # OSM download; --refresh ignores the cache
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

**Current data, 2026-10-15** (`REGION` rectangle, 41 of 49 cells): 28,854
businesses in OSM, 12,448 chains (brand tag 10,901, NSI 134, 3+ locations
by name 1,285, shared website 128), 14,784 small businesses after unnamed,
non-businesses and vape shops are removed. By group: food 6,526, shopping
2,929, personal care 2,101, services 1,708, groceries 1,520. `search.json`
1.89 MB.

**Organic Maps tiles, 2026-10-15** (43 MB on disk, 6,982 tiles; export
takes about 25 s):

| zoom (OM) | MapLibre zoom | tiles | pins | median | largest |
|---|---|---|---|---|---|
| 10 | 9 | 8 | 1,757 | 99 KB | 314 KB |
| 11 | 10 | 26 | 3,035 | 27 KB | 329 KB |
| 12 | 11 | 80 | 4,509 | 11 KB | 299 KB |
| 13 | 12 | 253 | 6,228 | 3 KB | 256 KB |
| 14 | 13 | 582 | 8,145 | 2 KB | 164 KB |
| 15 | 14 | 1,141 | 10,025 | 1 KB | 97 KB |
| 16 | 15 | 1,903 | 11,810 | 1 KB | 55 KB |
| 17 | 16+ | 2,989 | 14,784 (all) | 1 KB | 31 KB |

Low-zoom tiles are mostly count stats.

The district tables below are history, from before districts were removed.

**Metro districts after the chain filter (layers 1 and 1b), 2026-10-13:**

| district | businesses in OSM | chains | not chains |
|---|---|---|---|
| DC-AL | 4,752 | 1,327 | 3,425 |
| MD-04 | 1,975 | 1,095 | 880 |
| MD-05 | 2,297 | 1,195 | 1,102 |
| MD-06 | 3,444 | 1,426 | 2,018 |
| **MD-08** | **2,687** | **1,055** | **1,632** |
| VA-07 | 4,187 | 1,745 | 2,442 |
| VA-08 | 4,172 | 1,674 | 2,498 |
| VA-10 | 3,562 | 1,667 | 1,895 |
| VA-11 | 3,662 | 1,868 | 1,794 |
| **total** | **30,738** | **13,052** | **17,686** |

Chains by how they were caught: OSM brand tag 11,475, NSI name 131,
3+ locations by name 1,315, shared website 131.

Brand tags do most of the work; NSI and our own count catch chains mappers
forgot to tag.

**Small businesses by map group, 2026-10-13** (chains, unnamed places,
non-businesses and vape shops removed; layer 2 not run yet):

| district | food | groceries | personal care | services | shopping | total |
|---|---|---|---|---|---|---|
| DC-AL | 1,695 | 491 | 334 | 231 | 501 | 3,252 |
| MD-04 | 309 | 105 | 118 | 103 | 130 | 765 |
| MD-05 | 331 | 140 | 120 | 129 | 173 | 893 |
| MD-06 | 675 | 223 | 217 | 222 | 363 | 1,700 |
| **MD-08** | **607** | **157** | **213** | **213** | **287** | **1,477** |
| VA-07 | 638 | 172 | 329 | 349 | 545 | 2,033 |
| VA-08 | 1,080 | 140 | 367 | 281 | 434 | 2,302 |
| VA-10 | 741 | 138 | 239 | 199 | 377 | 1,694 |
| VA-11 | 759 | 78 | 256 | 171 | 336 | 1,600 |

All 9 metro districts: 30,738 businesses → 17,686 after chains → 15,989
after unnamed → 15,806 after non-businesses → **15,716** after vape shops.

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
- **2026-10-05 (type chips):** Discussed an NVIDIA-hosted AI model for
  generic searches ("pizza place", "chinese food"); Conrad chose a tag
  filter instead. Picking a category tab now shows chips for the types
  inside it. In MD-08 Food & drink: Restaurant 483, Cafe 73, Fast food 53,
  Chinese 49, Mexican 39, Pizza 38, American 35, Bakery 35, Italian 26 and
  46 more behind "More". Personal care: Beauty 93, Hairdresser 92, Optician
  14, Massage 8, Tattoo 8... Across the metro area 68% of food places
  (5,278 of 7,747) have an OSM cuisine tag; the rest still appear under
  their type (Restaurant, Cafe...). Changing tab or district clears the
  chip; a search pick clears it so the result isn't hidden. Tested in
  Chrome: choosing Italian in MD-08 leaves only its 26 pins.
- **2026-10-05 (double-click districts):** Double-clicking anywhere inside a
  district now switches to it: bold outline, zoom to fit, its businesses
  and counts load (same as the dropdown). The map's built-in double-click
  zoom is off so the two don't clash; scroll and the +/- buttons still
  zoom. Double-click is ignored while choosing a directions start point.
  The 11 districts outside the metro area have no business file yet, so
  they get outlined with a "No business data yet" note instead of an
  error, and the dropdown shows them while selected. A hint at the bottom
  of the map says "Double-click a district to switch to it". Tested in
  Chrome: double-click near Reston switched MD-08 to VA-11 (1,839
  businesses); near Columbia switched to MD-03 with the note.
- **2026-10-06 (smoother district switch):** Conrad found the jump after a
  double-click awkward. Switching districts now flies instead of a 0.8 s
  snap: it zooms out, glides, then zooms in over 2.4 s with ease-in-out
  (`DISTRICT_FLIGHT_MS`, `DISTRICT_FLIGHT_CURVE` in `BusinessMap.tsx`). The
  first view when the page opens jumps straight to MD-08 with no
  animation. The flight is not marked essential, so MapLibre skips it for
  people whose system asks for reduced motion. Checked with frames
  captured mid-flight in Chrome: the camera pulls out to the wider DC
  area, then settles on the new district.
- **2026-10-06 (better tags, tag-first search):** Conrad asked for five
  features: average price, better tags (menus and more), tags ahead of
  names in search, reviews, customer traffic. Decided to build only what
  our data supports for now; price, reviews and traffic wait on an outside
  service. Built: (1) `tagging.py` with name-word rules and OSM detail tags,
  kept by `businesses.py` (re-run from the cache, no download). Food places
  with a cuisine or dish tag went from 68% (5,278 of 7,747) to 74% (5,719);
  name rules added 2,774 tags (nails 569, barber 313, sandwich 121, chicken
  82, pizza 39...). Feature tags across the metro: outdoor seating 776,
  wheelchair accessible 709, takeout 666, delivery 238, vegetarian 222,
  Wi-Fi 211, vegan 97, halal 73. Fixed two bad rules found by spot check:
  "cafe" no longer means coffee shop ("Cafe Vy" is Vietnamese), and the
  brow rule no longer matches "Brown's". (2) Search ranks tag matches
  first, with a "show all on the map" row. Tested in Chrome on MD-08:
  "pizza" → 43 pizza places, "chinese food" → 51 Chinese places, "coffee" →
  73 cafes, "barber" → 28, "take out" → 65; "show all" for pizza opened Food
  & drink with the Pizza chip and 43 pins. (3) The info panel shows tags
  (Restaurant · Chinese), feature chips (Takeout, Delivery) and a menu link
  when OSM has one. Search index grew to 2.33 MB (tags per business).
- **2026-10-12 (warmer design, saved spots):** Conrad asked for a more
  human UI using skills found online, plus favorites with their own tab.
  Installed `anthropics/skills@frontend-design` (977K installs, design
  guidance only) and followed its process: a written design plan (Look and
  feel above), checked against its list of template tells, then
  screenshots to critique. Changes: new palette and fonts; the header leads
  with the district name in large type plus a count; "Everything" replaces
  "All"; business panels say "Chinese restaurant" instead of
  "Restaurant · Chinese"; no more middle-dot strings or ALL-CAPS eyebrows;
  friendlier empty, loading and error text; "You're here. Enjoy …!" on
  arrival; business names beside pins when zoomed in. Added Save / Saved and
  the Saved tab. Fixes from self-review: the panel's colored top edge
  curved around the corners (now a straight stripe), "General" read oddly
  (now "General store", plus a few other type names), and the phone header
  took about a quarter of the screen (now title and picker share a row).
  Tested in Chrome: saved 2 spots, both listed in the Saved tab with
  marigold rings, still there after a reload; no sideways scrolling at
  390 px wide.
- **2026-10-13 (minimal design, chain fix, saved everywhere):** Four asks
  from Conrad. (1) Drop the green, more minimal: interface is now black,
  white and grays; color only on category pins and saved spots; base map
  switched to OpenFreeMap Positron; panel color stripes removed. (2) Saved
  tab couldn't be turned off: pressing it again, or the list's ×, now
  returns to the previous tab. (3) "Tons of Kusshi sushi places": Kusshi
  (6 locations) wasn't on OSM's or NSI's chain lists. Added layer 1b, our
  own count: 352 brand names appeared 3+ times among "small businesses"
  (1,428 places). Now caught: 1,315 by repeated name (town suffix removed,
  so "Kusshi Bethesda" counts) and 131 by shared website. Generic names
  stay unless their website matches. First run flagged 12,098 by website:
  missing websites were read as the text "nan"; fixed, and the website
  must contain the business name (a mall's site no longer makes its stores
  a chain). Result: MD-08 1,642 → 1,477 small businesses; metro 17,155 →
  15,716. Not caught yet: generic-named chains without a website, and
  chains with 1-2 locations here (layer 2). (4) Saved spots show in every
  district: their own map layer from the saved list. Tested in Chrome:
  saved a spot in MD-08 and one in DC, switched to VA-08, opened Saved; the
  map zoomed out to show both with marigold rings.
- **2026-10-13 (Google Maps-style pins):** Conrad found the always-on pins
  cluttered and asked for pins that load as you zoom into areas, like
  Google Maps, with saved spots always visible. Rewrote the map: business
  files load for every district on screen; pins are symbols that hide when
  they'd overlap, with spacing that shrinks as you zoom in; best-described
  businesses keep their spot; names from zoom 15. The header now names the
  district at the map's center with "N independent businesses in view", and
  counts and chips follow the view. The district dropdown ("Go to
  district") and double-click fly there instead of switching data. Tested
  in Chrome: opening view about 80 pins show of 5,878 in view; two zoom
  steps in, more appear; on Bethesda's Woodmont Avenue every pin has a
  name and none overlap; clicking a pin (Fialova) opens it; a search pick
  in another area loads that district and opens the business.
- **2026-10-15 (districts removed, screen tiles):** Conrad asked to delete
  all the Python that defines congressional districts and load businesses
  for whatever is on screen, Google Maps style. Chose prebuilt map tiles
  (not live Overpass from the browser, which is slow and rate-limited) and
  no district UI at all. Deleted `pipeline/fetch/districts.py`,
  `districts.geojson` and the per-district business files. `businesses.py`
  now covers one rectangle (`REGION`) in 0.2° cells, skips cells that fail,
  and has `--offline`. The export writes 0.1° tiles plus `tiles.json`;
  `MapView` loads tiles on screen. Header shows the main town near the map's
  center. Search ranks on-screen matches first; Saved and search no longer
  show district ids. Double-click zooms again. Overpass was "at capacity"
  all session, so 37 cells were filled from the old per-district caches
  (one-off script, not in the repo) plus 4 cells that old data covered
  80-100%. Still missing: 8 cells in the northeast (Columbia, Ellicott City,
  Baltimore edge); `-77.10_39.10` is about 81% complete. When Overpass is
  free, delete `data/raw/osm/cells/-77.10_39.10.json` and run
  `businesses.py` plus the rest of the pipeline. Tested with headless
  Chrome: the map opens on Bethesda with pins and no district lines; after a
  drag, new tiles loaded but the header's count and town did not change.
  Not yet known whether that is a real bug or the fake mouse; check in a
  real browser.
- **2026-10-15 (Organic Maps tiles):** Conrad asked to draw the map the way
  Organic Maps does and cut tiles the same way, keeping every business
  going through the filter pipeline. First looked at the Organic Maps APK
  (F-Droid 2026.09.29) with REA: the Java side only passes calls to the C++
  library `liborganicmaps.so`, so the method was read from their open source
  instead (`libs/drape_frontend`, `libs/geometry/mercator.cpp`,
  `libs/indexer/scales.hpp`). Replaced the 0.1° tiles with their tile
  pyramid, per-zoom thinning, screen coverage plus 75 px, cancelling and
  dropping off-screen tiles, and keeping the old zoom until the new one
  arrives (details in "How the map shows businesses"). `rank` moved from
  the browser to the pipeline. Counts and chips now come from per-tile stats.
  The export now refuses businesses that didn't pass the chain filter: all
  14,784 passed. Tested with headless Chrome on a production build: opening
  view loads 12 zoom-12 tiles, 2,512 businesses in view around Rockville;
  zooming in loads zoom-14 tiles; a drag now updates the header's town and
  count (the open question from the last entry is fixed); zoomed out the
  Groceries tab shows well-spread green pins with chips; a search pick
  ("Sunshine General Store") opens its panel, which stays open after
  zooming out. No console errors. Not done: 8 northeast cells are still
  missing from the data (see the entry above).
