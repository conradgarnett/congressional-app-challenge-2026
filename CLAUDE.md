@AGENTS.md

# MD-08 Local Map — notes for whoever works on this next

Congressional App Challenge 2026 entry (our district: Maryland's 8th, Rep.
Jamie Raskin). An interactive map of the DC area that finds small,
independent businesses, drawn with Organic Maps' own map rules. Businesses
load for whatever part of the map is on screen; the app no longer uses
district lines at all (removed 2026-10-15). Built for laptops first.

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

The team's rule: **two or fewer locations in the whole US**; chains are
dropped. A national chain can have one store in our area, so counting
locations here is not enough on its own. Better to wrongly keep a
three-location business than to wrongly drop a family shop.

**The algorithm** (`pipeline/filter/independent.py`, rebuilt 2026-10-15):

1. **Identity.** Each business gets its name (lowercased, store numbers and
   town names removed: "Kusshi Bethesda" reads as Kusshi), website domain
   (on shared hosts like facebook.com, Toast or Yelp, the page path instead;
   a builder subdomain is the business's own), phone, email, Instagram and
   Facebook handle (Facebook `profile.php?id=` uses the id), operator and
   brand Wikidata id.
2. **Graph.** Two businesses are linked when they share a strong identity.
   A shared website or phone also needs a word in common between the names
   (malls and office switchboards). Same name links only when the name is
   **distinctive**: one of its words is used mostly by that exact name
   (Kusshi, Pupatella, Moby Dick), measured from all 28,854 names. "Golden",
   "Dragon", "China", "King" appear in dozens of unrelated names, so Golden
   Dragons and China Kings stay separate. Name links also need the same map
   group, and no two different websites unless every website carries the
   name's own word (mobydickhouse.com and mobydickkabob.com are one brand;
   rasa.co and rasagrill.com are not).
3. **Entities and locations.** Each connected part of the graph is one
   business. Its locations are members more than 60 m apart (a shop mapped
   as a point and as a building is one location).
4. **Chain when** 3+ locations here; or any member has a brand Wikidata id;
   or the name is a Name Suggestion Index brand sold in the US in the same
   map group (an auto body "Body Shop" isn't The Body Shop); or a brand tag
   plus 2 locations.
5. **Run by an institution** = not independent: a `.edu`, `.gov` or `.mil`
   website, a campus-dining or bookstore contractor's site (Sodexo,
   dineoncampus, Barnes & Noble College...), or an operator tag naming a
   university, college, Smithsonian, county, city or such a contractor.
   Catches campus dining, Smithsonian cafes, college bookstores, and the
   state and county liquor stores (Virginia ABC, Montgomery County ABS).
6. **Chain store locator** = chain, even with 1-2 stores here: a website
   with a store number or state/city folders after `/locations/` or
   `/stores/` (`thecapitalgrille.com/locations/dc/washington/.../8003`).
   Catches national chains NSI doesn't list (Capital Grille, Eddie V's,
   Elephant & Castle, CPR Cell Phone Repair, 7-Eleven franchisees).
7. Unnamed places, non-businesses (vacant, malls, vending machines, ATMs,
   lockers), vape shops and smoke shops are dropped too.

**No AI model decides this** (Conrad asked about a small NVIDIA model,
2026-10-15). A model would guess from a name and category, can't explain
its choice, may change between runs, and a hosted one needs an API key.
Missed cases are fixed with rules on data OSM already has. If a model is
ever added, only offline in the pipeline, for unsure cases, with a person
approving its changes.

Every decision and its reason is in `data/processed/business_decisions.csv`.
Known weak spot: generic-looking names with no website (four "Great Wall"
restaurants without websites count as one chain).

## How the map is drawn

**Like Organic Maps, from their own rules** (rebuilt 2026-10-15). Their app
draws from `.mwm` files with its own C++ engine, which can't run in a
browser. So the site keeps their *rules* and applies them to OpenFreeMap's
vector tiles:

- **Drawing rules from the app itself.** `pipeline/style/drules.py` decodes
  `assets/drules_default.bin` from the Organic Maps APK (format "OMDR" v1;
  a port of `libs/indexer/drules_format.cpp`). It holds, for 1,177 feature
  types at every zoom, line widths and colors, area fills, icons, label
  sizes and priorities. Checked against their own text dump
  (`data/drules_default.txt`): the values match. Stored alpha is
  transparency (opacity = 255 - alpha), and a resolved color of 0 means
  "no outline".
- **Style.** `pipeline/style/build_style.py` maps OpenMapTiles classes to
  Organic Maps types (`transportation` class `primary` + bridge →
  `highway-primary-bridge`, landcover `wood` → `landuse-forest`...) and
  writes `public/map/style.json`: 248 layers, drawn in their priority order
  (geometry low first, labels and icons high last). Their zoom z is
  MapLibre zoom z-1. Background `#E3E1D2` is their land color. Base-map
  points of interest are landmarks only (schools, parks, churches,
  libraries, stations...), with their icons; shops and restaurants from the
  base map are left out so no chain shows.
- **Icons.** Their icon atlas (`symbols.png` + `symbols.xml`, 860 icons) is
  converted to a MapLibre sprite, 1x and 2x (`public/map/sprite*`).
- **Business pins** use their icon for each OSM type (`public/map/types.json`;
  95% exact, the rest use their generic shop/craft icon) and their overlay
  order: drules priority first (a restaurant beats a hairdresser, as in
  their app), then our `rank` as their "rank" byte: a fixed random number
  per business (from its OSM id), not how much is online. See "Fair ranking"
  (`CalculateOverlayPriority`). Overlapping pins hide, best first. Names
  show under pins from MapLibre zoom 15.
- **Highlights** are their search-result pins: hovering a row in the list,
  or opening a place, raises it on the map. Saved places use their bookmark
  glyphs on a bookmark-red dot. Routes use their route blue `#0087ff` with
  outline `#055fcd` (purple for bike, dark blue for walking) and their
  start/finish markers.
- **Licence.** Organic Maps code, styles and icons are Apache-2.0; the
  compiled `.bin` is an Organic Maps Data File. The map credits "Map data ©
  OpenStreetMap and Organic Maps" with links (in the style's attribution).

**Business tiles: the same tiles as Organic Maps.**

- Their Mercator (x = longitude, y = latitude stretched, both -180..180) and
  tile keys: a tile at zoom z is 360 / 2^(z-1) Mercator degrees wide,
  numbered from 0,0 with y going north (`tile_key.cpp`, `tile_utils.cpp`).
  Zoom 17 is the deepest data zoom. We export zooms 10 to 17.
- **Each zoom holds only what it draws** (their scale index): every business
  gets `z`, the first zoom where it wins its cell (16 cells per tile side,
  about 32 px) in the overlay order above, and `gz`, the same within its
  own group. Zoom-17 tiles hold every business.
- **Screen coverage** (`ResolveTileKeys`): on every pan or zoom
  `hooks/useTiles.ts` fetches the tiles covering the screen plus 75 px,
  cancels ones that left before arriving, drops ones that left, and keeps
  the previous zoom until every new tile has arrived.
- **Counts count every business, not just pins**: tiles below zoom 17 carry
  counts per group and tag for 16 x 16 cells, added by the share on screen;
  zoom-17 tiles are counted one by one. Median error under 1% on 160 random
  views; worst about 30% on small counts at the screen edge.

**Fair ranking** (Conrad, 2026-10-15). The app exists to help underserved
businesses, and nearly half of ours (48%) have no website, phone or hours
on OSM. Ranking by how well described a place is hid exactly them: at the
widest zoom they got only 32% of the pins. Now the tiebreak is a fixed
random number per business, and they get 48%, their real share. Never cut
or rank down a business for having little online.

## Map categories

Every small business sits in one of five groups: **Food & drink, Groceries
& essentials, Personal care, Services, Shopping.** Vape shops are left out
entirely (team decision for the school demo), and since 2026-10-15 so are smoke shops: every `shop=tobacco` except
cigar shops and tobacconists (most "tobacco" shops here are vape and smoke
shops). Cannabis dispensaries stay. The map opens on **Everything**: Conrad decided against making
food the default view. Groups are assigned by `GROUPS` in
`pipeline/filter/independent.py`; any other shop is Shopping, any other
trade (`craft=*`) Services.

Inside a group, **type chips** narrow further: OSM cuisines and types
(Pizza, Cafe, Hairdresser...), most common in view first, then features
(Takeout, Outdoor seating, Wheelchair accessible...) with a dashed edge.
Tags are built by `pipeline/load/tagging.py` from OSM cuisine and type,
words in the name ("Taqueria" means Mexican), and OSM detail tags.

**Search puts tags first.** "pizza" or "chinese food" names a tag; the first
result is "Show every pizza place", which opens the group and chip. Then
names, then streets and towns; matches on screen first. "/" focuses search.

**Not built yet, waiting on outside data** (team decision 2026-10-06):
average price, reviews, customer traffic. OSM has no price tags in our
data; reviews and traffic need a service such as Google Places or Yelp.

## Look and feel

**Desktop first** (Conrad, 2026-10-15: "we are not testing the app on a
phone"). Rebuilt from scratch with the `frontend-design` skill; nothing kept
from the earlier designs.

- **Layout:** a fixed 400 px white sidebar on the left (place name and
  count, search, groups, chips, then the list of places on the map, a
  place's details, directions, or saved places); the map fills the rest.
  Below 760 px wide the map goes on top and the panel below; real mobile
  design comes later.
- **List and map are one thing:** the list shows the places drawn on the
  map, in the map's own order (up to 60). Hovering a row raises that place
  on the map; clicking opens it and flies there.
- **Color:** the map carries the color (Organic Maps' palette). The
  interface is white with ink `#22313A`, muted `#5D6B73`, hairlines
  `#D9DDD8`, and one accent, `#1E96F0`, which is Organic Maps' own selection
  color from the drules (`app/globals.css`).
- **Type:** Public Sans only, the US government's civic typeface (USWDS).
- **Dark mode:** Light / Dark / Auto switch top right of the sidebar
  (`hooks/useTheme.ts`; Auto follows the computer, the choice is kept in
  the browser; a tiny script in `app/layout.tsx` sets it before the first
  paint). The map switches to Organic Maps' own dark palette and dark icons
  (`public/map/style-dark.json`, `sprite-dark*`, from the same drules), and
  the interface to dark tokens in `app/globals.css`.
- **Pins on discs:** Organic Maps draws its icons bare, which got lost on
  their tan land (cafe icons especially). Each business icon is drawn onto a
  white disc with a thin ring (dark disc in dark mode), made in the browser
  from the sprite icon the first time it's needed
  (`setMissingStyleImageResolver` in `OrganicMap.tsx`).
- **Words:** plain, sentence case, from the visitor's side. No ALL-CAPS
  labels, no "A · B · C" strings. Errors say what happened and what to do.

## Saved spots

**Save** in a place's details keeps it in **Saved** (`hooks/useSaved.ts`),
stored in the browser's localStorage: no account, so they stay on that
computer. Saved places are always on the map as Organic Maps bookmarks,
even where tiles haven't loaded. Saved lists them and fits the map to them;
pressing Saved again returns to the previous group.

## Constraints that will break things if ignored

**The tile scheme lives in the export.** `MIN_TILE_ZOOM`,
`MAX_DATA_ZOOM`, `THIN_CELLS` and `STAT_CELLS` in
`pipeline/load/export_site_data.py` decide the tiles; the site reads zooms,
cells and the covered area from `public/data/tiles.json`. The tile math
itself (Mercator, tile size, MapLibre zoom + 1) is in both the export and
`lib/geo/tiles.ts`: change one, change the other.

**Only filtered businesses reach the site.** The export reads
`small_businesses.geojson` and stops with an error if any business in it is
not marked independent in `business_decisions.csv` or has no group. Rerun
`pipeline/filter/independent.py` first.

**The map style is generated, not hand-written.** Change
`pipeline/style/build_style.py` (mappings, halo width, landmark list) and
rerun it; don't edit `public/map/style.json`. It needs the drules and icons
from the APK once: `build_style.py --apk path/to/app.organicmaps_*.apk`
copies them into `data/raw/organicmaps/` (git-ignored). Without them it
keeps the committed style. MapLibre needs an absolute sprite URL, so
`OrganicMap.tsx` adds the site's origin when it loads the style.

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
  OSM data), styled with Organic Maps' rules (see "How the map is drawn").
  Not OSM's standard image tiles: those have every shop and gas station
  drawn in, chains included.
- **"Add a missing business" → editing API v0.6** at api.openstreetmap.org.
  Needs OAuth 2.0 (`write_api` scope, `Authorization: Bearer <token>`).
  Never use it for bulk reads: its bounding-box size is capped.
- **Attribution is required**: "Map data © OpenStreetMap and Organic Maps"
  with links (ODbL and the Organic Maps data licence). It is in the style.

**MapLibre 6 loads its worker from a separate file.** Next.js bundles
MapLibre's main code into a chunk, so the worker's default relative URL
breaks ("Worker failed to load") and the map shows tiles but no pins or
outlines. `scripts/copy-maplibre-worker.mjs` copies the worker into
`public/maplibre/` on `npm install`, `npm run dev` and `npm run build`, and
`OrganicMap.tsx` calls `setWorkerUrl` on it. Its CSS also sets the map
container to `position: relative`, so `OrganicMap.tsx` sizes it inline or
the map is zero pixels tall. MapLibre 6 also has **no
default export**: use named imports.

**Next.js 16 is newer than most training data.** Read
`node_modules/next/dist/docs/` before writing app code (see `AGENTS.md`).
`next dev` rewrites the block in `AGENTS.md`; this file is left alone.

## Layout

- `app/`, `components/`, `features/`, `lib/`, `hooks/`, `types/`: Next.js
  site (App Router, TypeScript). Folder plan from `prompt.md`.
  - `app/page.tsx` renders `components/app/LocalMap.tsx`: the sidebar and
    the map, and the state between them (group, chip, selected place,
    hovered row, directions).
  - `components/map/OrganicMap.tsx`: the MapLibre map with the generated
    Organic Maps style, business pins, highlights, saved bookmarks, route
    (browser only, loaded with `ssr: false`).
  - `components/sidebar/`: `SearchField`, `Filters` (groups and chips),
    `PlaceList`, `PlaceDetail`, `DirectionsView`, `SavedList`, one
    stylesheet `Sidebar.module.css`.
  - `hooks/useTiles.ts`: loads the Organic Maps tiles on screen and counts
    what's in view. `lib/geo/tiles.ts`: the tile math.
  - `lib/search.ts` (search over `search.json`), `lib/tags.ts` (chip
    labels), `lib/groups.ts` (group names, type labels).
  - Directions: `hooks/useRouteSession.ts` (live navigation state: start,
    route, position, next turn, off-route rerouting, demo trip),
    `lib/routing/` (Valhalla requests, geometry, formatting),
    `types/routing.ts`.
- `public/map/`: the generated map style, sprites and business type rules
  (from `pipeline/style/build_style.py`).
- `public/data/`: the site's data, written by `pipeline/load/export_site_data.py`.
  `tiles/<z>/<x>_<y>.json` (one Organic Maps tile: GeoJSON pins plus count
  stats) and `tiles.json` (zooms, covered area, and which tiles have
  businesses, so the site never asks for an empty one). About 7,000 small
  files, 44 MB. `search.json`: every business name, loaded when someone
  clicks into search.
- `pipeline/`: offline Python data jobs. Not part of the site.
  - `fetch/businesses.py`: OSM businesses in `REGION`, one Overpass query per
    0.2° cell (cached in `data/raw/osm/cells/`) → `data/processed/businesses.geojson`.
    A cell that fails is skipped and named at the end; rerun to fill it in.
  - `filter/independent.py`: the small-business algorithm and map groups →
    `data/processed/small_businesses.geojson` and `business_decisions.csv`
  - `style/drules.py`, `style/build_style.py`: Organic Maps drawing rules →
    `public/map/`
  - `load/export_site_data.py`: checks every business was judged
    independent, attaches Organic Maps icons and priorities, cuts Organic
    Maps tiles → `public/data/`
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
.venv/bin/python pipeline/filter/independent.py       # small businesses + groups; downloads NSI the first time
.venv/bin/python pipeline/style/build_style.py        # map style; add --apk <path> the first time
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

**Current data, 2026-10-15, new algorithm** (`REGION` rectangle, 41 of 49
cells): 28,854 businesses in OSM. Chains: 11,449 with 3+ locations here,
508 with a brand Wikidata id, 55 Name Suggestion Index brands, 20 brand tag
plus 2 locations. Also dropped: 1,384 unnamed, 169 non-businesses, 70 vape
shops. **15,040 small businesses** after 65 institution-run places, 109
smoke shops and 16 store-locator chains were also dropped (2026-10-15 later). Graph links: 9,842 brand id,
6,281 website, 9,004 distinctive name, 279 operator, 171 phone, 98
social/email. `search.json` 1.94 MB.

**Organic Maps tiles, 2026-10-15** (6,982 tiles; export about 25 s):

| zoom (OM) | MapLibre zoom | tiles | pins | median | largest |
|---|---|---|---|---|---|
| 10 | 9 | 8 | 1,770 | 107 KB | 329 KB |
| 11 | 10 | 26 | 3,080 | 29 KB | 344 KB |
| 12 | 11 | 80 | 4,590 | 12 KB | 318 KB |
| 13 | 12 | 253 | 6,364 | 4 KB | 272 KB |
| 14 | 13 | 582 | 8,334 | 2 KB | 177 KB |
| 15 | 14 | 1,152 | 10,267 | 2 KB | 105 KB |
| 16 | 15 | 1,935 | 12,119 | 1 KB | 61 KB |
| 17 | 16+ | 3,042 | 15,199 (all) | 1 KB | 35 KB |

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
- **2026-10-15 (Organic Maps rebuild, desktop first):** Conrad found the
  map still looked like before and asked to reverse engineer Organic Maps'
  rendering itself, rebuild everything from the concepts only, write our own
  small-business algorithm, and design for laptops (no phone testing yet).
  On a new branch `organic-rebuild`:
  (1) **Rendering:** decoded `drules_default.bin` from the shipped APK (OMDR
  v1, ported from `libs/indexer/drules_format.cpp`; values match their text
  dump) and read how their renderer applies it (`apply_feature_functors.cpp`
  colors and caption anchors, `overlay_handle.cpp` priority packing). Built
  a MapLibre style from it over OpenFreeMap tiles: 248 layers, their colors,
  widths, label sizes, landmark icons and draw order; their 860-icon atlas
  as the sprite. Pins use their icon and overlay priority per type. Bugs
  found on the way: colors store transparency not opacity; outline color 0
  means none (labels had black halos); dash arrays inside zoom steps need
  `literal`; the map container was zero pixels tall under MapLibre's CSS.
  (2) **Algorithm:** `pipeline/filter/independent.py` replaces the old chain
  filter and group script (deleted with `businesses_layer1.geojson` and the
  empty `national`/`matching` folders). Identity graph + distinctive-name
  test (details above). Spot checks: Kusshi 6, Moby Dick 21, Lebanese
  Taverna 7, Matchbox 9, Mamma Lucia 9, Z-Burger 9 caught as chains; China
  King (8 shops) and the "Golden …" places stay independent. Found and fixed
  on the way: Facebook `profile.php` links had merged 10 unrelated
  businesses; Rasa (rasa.co) vs Rasa Grill were merged by name. 15,199 small
  businesses (was 14,784).
  (3) **Interface:** all old components deleted; new desktop layout
  (sidebar + map, list of places on the map coupled to the map by hover),
  Public Sans, Organic Maps' selection blue as the one accent.
  Tested in headless Chrome at 1440x900 on a production build: map renders
  with no console errors; list hover raises the search-result pin; "pizza"
  search opens Food & drink with the Pizza chip; "Sunshine General" opens
  the place; Save, then Directions from a fake GPS in Olney: walk 5.4 mi,
  1 hr 49 min, route drawn in Organic Maps blue, simulated trip shows the
  next turn; Saved lists the place. Not done: real mobile layout; the 8
  missing northeast data cells.
- **2026-10-15 (visible pins, dark mode):** Conrad found some pins hard to
  see and asked for dark mode. Pins now sit on a disc with a ring (light:
  white, dark: `#262c2f`). Dark mode uses Organic Maps' dark variant: the
  drules file holds both palettes (dark roads `#753800`, water `#002222`,
  background `#0F0F0F`) and the APK ships dark icon atlases, so
  `build_style.py` now writes both styles and sprites. Switching reloads
  the map style and re-adds our layers on `style.load`. MapLibre 6 needs
  `setMissingStyleImageResolver` (the old event can't supply images), and
  the resolver waits for the sprite icon to load. Tested in headless
  Chrome: pins drawn on discs, Dark switches map and sidebar, the choice
  survives a reload, Light switches back; no errors besides software-GPU
  notes.
- **2026-10-15 (de-slop pass, institution rule):** Conrad pasted a list of
  anti-"AI look" tools. Checked the app against no-slop-ui's banned patterns
  and checklist, avoid-ai-design's tells catalog and scanner (read first:
  file reads only), hallmark's anti-patterns and no-ai-slop's copy rules.
  Fixed: the small "Local Map" label above the place name (eyebrow +
  headline) is now a plain app bar with the theme switch; place name 22 px
  instead of 30 px; chips 6 px corners instead of pills; "‹" glyph removed
  from back links; panel `#fcfcfb` instead of pure white; smaller dropdown
  shadow; curly apostrophes. Scanner: 0 findings after marking the dark
  ground as deliberate (it is Organic Maps' dark land color). Conrad also
  saw a George Mason store counted as small and asked about an NVIDIA
  model. Couldn't find that store by name, but found the class of error:
  institution-run places. Added the rule above: 65 places dropped (Virginia
  ABC, Montgomery County ABS, GWU/UMD/GMU/Marymount campus dining, Smithsonian
  and memorial cafes, college bookstores). 15,165 small businesses.
- **2026-10-15 (smoke shops, store locators):** Conrad felt 15k small
  businesses was a lot and asked to remove vape shops. Vape-tagged shops
  were already out (71); an audit found most `shop=tobacco` places are smoke
  and vape shops by another tag ("Smoke Hut", "Tobacco Plus: vape, CBD,
  kratom"), so all tobacco shops except cigar shops and tobacconists are
  dropped now (109; "cigarette" no longer counts as cigar). Also found
  national chains with 1-2 stores here; their websites are chain store
  locators, now a chain rule (16; an old Urbanspoon listing number and
  street numbers in addresses don't count). 15,040 small businesses.
- **2026-10-15 (fair ranking):** `rank` was "how well described" (website,
  hours, phone, tags), so when pins competed for space, shops with nothing
  online lost. Conrad: cutting or hiding them goes against helping
  underserved businesses. `rank` is now a fixed random 0-255 from the OSM
  id (sha256), still after Organic Maps' type priority. Measured share of
  pins for shops with no website, phone or hours: widest zoom 32% → 48%,
  MapLibre zoom 11 38% → 46%, zoom 13 42% → 46% (48% of all businesses).
  Sidebar note now reads "N of M on the map" instead of "best-described".
- **2026-10-15 (paused, next up):** Conrad: pin colors look alike (Organic
  Maps colors by its own broad classes) and too many pins at once. Plan, not
  built yet: color each disc by our group with the icon on top (light-map
  set validated with the dataviz validator, all pairs: services `#2a78d6`,
  food `#eda100`, personal care `#e87ba4`, groceries `#008300`, shopping
  `#b23f9a`; dark icon on the amber and pink discs; dark-map set still to
  pick), and thin harder (`THIN_CELLS` 16 → 8, smaller pins zoomed out).
- **2026-10-21 (health check, NSI download):** Conrad asked for a full
  check of the app before more work. Passed: `npm ci`, lint, `tsc`,
  `npm run build`, and a headless browser run of the built site (load,
  search "tacos", open a place, save it and see it after reload, walking
  directions and Simulate trip, groups and type chips, zoom out and in,
  pin click, dark theme kept after reload, 390 px phone width). No page
  errors. All 7,065 tiles in `tiles.json` exist and parse; tiles and
  `search.json` hold the same 15,040 businesses. Broken: nothing downloaded
  `data/raw/nsi.json` (git-ignored), so `independent.py` crashed on a fresh
  clone. It now downloads NSI 8.0.20260918 (pinned) on first run; that
  version changes 14 of 28,854 decisions against the committed data, which
  was left as is. Open, needs a team call: national chains with 1-2 stores
  here that NSI doesn't place in DC/MD/VA and that carry no brand tag stay
  "small" (PLANTA, Foxtrot, California Fish Grill seen in the Bethesda
  list). Counting any US-state NSI brand would flag 19 kept businesses:
  real chains (California Fish Grill, Eastern Mountain Sports, Heytea,
  Moxies, Poke Bros, The Tile Shop, Xi'an Famous Foods) but also generic
  names (Aroma, Joe's Pizza), and it still misses PLANTA and Foxtrot (not in
  NSI), so it was not changed. `npm audit`: 5 high, all in
  `eslint-config-next`'s dev-only glob library, not shipped; its suggested
  fix downgrades to Next 14, so ignored.
