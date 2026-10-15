"""Build the site's map style from Organic Maps' own drawing rules.

Organic Maps draws its map from .mwm files with its own engine. We can't
ship those to a browser, so we keep their *rules* and apply them to
OpenFreeMap's vector tiles (OpenMapTiles schema, free, no key):

1. Read the drules (drules.py) and icon atlas that ship inside the app.
2. Map each OpenMapTiles layer/class to the Organic Maps type it is
   ("transportation, class primary, bridge" → "highway-primary-bridge").
3. Turn each type's per-zoom rules into MapLibre layers: lines and areas
   with their widths and colors at every zoom, labels with their sizes, and
   icons. Their zoom z is MapLibre zoom z-1 (see lib/geo/tiles.ts).
4. Order everything the way their renderer does: geometry by drules
   priority (low first), labels and icons by overlay priority (high wins).

Input:  data/raw/organicmaps/  (drules_default.bin + symbols, from the APK)
Output: public/map/style.json, style-dark.json   (their light and dark palettes)
        public/map/sprite{,-dark}{,@2x}.{json,png}  (their light and dark icons)
        public/map/types.json  (icon, priority and zooms for business types)
Run from repo root:
  .venv/bin/python pipeline/style/build_style.py --apk ~/Downloads/app.organicmaps_*.apk
(--apk extracts the files once; later runs read data/raw/organicmaps/)

Licence: Organic Maps code, styles and icons are Apache-2.0; the compiled
.bin is an Organic Maps Data File. The map must show "Map data ©
OpenStreetMap and Organic Maps" with links (the style's attribution does).
"""

from pathlib import Path
import argparse
import json
import shutil
import xml.etree.ElementTree as ET
import zipfile

from drules import Drules, Element, css_color, decode

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "organicmaps"
OUT = ROOT / "public" / "map"

TILES_URL = "https://tiles.openfreemap.org/planet"
GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
FONT = ["Noto Sans Regular"]
# Organic Maps' backgrounds (data/styles/default/{light,dark}/colors.mapcss @background)
BACKGROUND = {"light": "#E3E1D2", "dark": "#0F0F0F"}
# Caption outline: the halo around map text
HALO_WIDTH = 1.4
MAX_ZOOM = 20

# 1x and 2x icon atlases (Android density folders), per palette
SPRITES = {"": "mdpi", "@2x": "xhdpi"}
VARIANTS = ("light", "dark")


def extract_from_apk(apk: Path) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(apk) as archive:
        (RAW / "drules_default.bin").write_bytes(archive.read("assets/drules_default.bin"))
        for density in SPRITES.values():
            for variant in VARIANTS:
                for name in ("symbols.png", "symbols.xml"):
                    target = RAW / "symbols" / density / variant / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(f"assets/symbols/{density}/{variant}/{name}"))


# ---------------------------------------------------------------- per-zoom rules


def by_zoom(drules: Drules, om_type: str) -> dict[int, Element]:
    """One element per zoom. Where a zoom has several (selector variants like
    "bbox_area>=4000000"), the first wins: OpenMapTiles has no such fields."""
    result: dict[int, Element] = {}
    for element in drules.types.get(om_type, []):
        result.setdefault(element.zoom, element)
    return result


def ml_zoom(om_zoom: int) -> int:
    return om_zoom - 1


def stops(values: dict[int, object]) -> list:
    """{om_zoom: value} → flat MapLibre stops [ml_zoom, value, ...]"""
    flat: list = []
    for zoom in sorted(values):
        flat += [ml_zoom(zoom), values[zoom]]
    return flat


def width_expression(widths: dict[int, float]):
    if len(widths) == 1:
        return next(iter(widths.values()))
    return ["interpolate", ["linear"], ["zoom"], *stops(widths)]


def step_expression(values: dict[int, object]):
    """Values that change per zoom (colors, dashes): hold each until the next zoom."""
    ordered = sorted(values)
    distinct = {json.dumps(values[zoom]) for zoom in ordered}
    if len(distinct) == 1:
        return values[ordered[0]]

    def literal(value):
        # Arrays inside expressions must be marked literal, or MapLibre reads them as expressions
        return ["literal", value] if isinstance(value, list) else value

    expression: list = ["step", ["zoom"], literal(values[ordered[0]])]
    for zoom in ordered[1:]:
        expression += [ml_zoom(zoom), literal(values[zoom])]
    return expression


CAPS = {0: "round", 1: "butt", 2: "square"}
JOINS = {0: "round", 1: "bevel", 2: "miter"}


def line_layers(drules: Drules, om_type: str, source_layer: str, layer_filter: list) -> list[tuple[int, dict]]:
    """A type can draw several lines at once (a bridge: casing, deck, road).
    Each distinct priority becomes one MapLibre line layer."""
    per_priority: dict[int, dict[int, dict]] = {}
    for zoom, element in by_zoom(drules, om_type).items():
        for line in element.lines:
            per_priority.setdefault(line["priority"], {})[zoom] = line
    layers = []
    for priority, lines in per_priority.items():
        widths = {zoom: max(line["width"], 0.5) for zoom, line in lines.items()}
        colors = {zoom: css_color(drules.argb(line["color"])) for zoom, line in lines.items()}
        first = lines[min(lines)]
        paint = {"line-color": step_expression(colors), "line-width": width_expression(widths)}
        dashes = {
            zoom: [round(max(dash / widths[zoom], 0.1), 2) for dash in line["dashdot"]["dashes"]]
            for zoom, line in lines.items()
            if "dashdot" in line
        }
        if dashes:
            paint["line-dasharray"] = step_expression(dashes)
        layers.append(
            (
                priority,
                {
                    "id": f"{om_type}:line:{priority}",
                    "type": "line",
                    "source": "openmaptiles",
                    "source-layer": source_layer,
                    "filter": layer_filter,
                    "minzoom": ml_zoom(min(lines)),
                    "maxzoom": ml_zoom(max(lines)) + 1,
                    "layout": {"line-cap": CAPS[first["cap"]], "line-join": JOINS[first["join"]]},
                    "paint": paint,
                },
            )
        )
    return layers


def area_layers(drules: Drules, om_type: str, source_layer: str, layer_filter: list) -> list[tuple[int, dict]]:
    areas = {zoom: element.area for zoom, element in by_zoom(drules, om_type).items() if element.area}
    if not areas:
        return []
    priority = areas[min(areas)]["priority"]
    layers = [
        (
            priority,
            {
                "id": f"{om_type}:area",
                "type": "fill",
                "source": "openmaptiles",
                "source-layer": source_layer,
                "filter": layer_filter,
                "minzoom": ml_zoom(min(areas)),
                "maxzoom": ml_zoom(max(areas)) + 1,
                "paint": {
                    "fill-color": step_expression({z: css_color(drules.argb(a["color"])) for z, a in areas.items()}),
                    "fill-antialias": False,
                },
            },
        )
    ]
    borders = {zoom: area["border"] for zoom, area in areas.items() if "border" in area}
    if borders:
        layers.append(
            (
                priority,
                {
                    "id": f"{om_type}:border",
                    "type": "line",
                    "source": "openmaptiles",
                    "source-layer": source_layer,
                    "filter": layer_filter,
                    "minzoom": ml_zoom(min(borders)),
                    "maxzoom": ml_zoom(max(borders)) + 1,
                    "paint": {
                        "line-color": step_expression({z: css_color(drules.argb(b["color"])) for z, b in borders.items()}),
                        "line-width": width_expression({z: max(b["width"], 0.5) for z, b in borders.items()}),
                    },
                },
            )
        )
    return layers


def text_paint(drules: Drules, captions: dict[int, dict]) -> dict:
    paint = {
        "text-color": step_expression({z: css_color(drules.argb(c["color"])) for z, c in captions.items()}),
    }
    # A resolved color of 0 means "no outline" (CaptionDefToFontDecl), not opaque black
    halos = {
        z: css_color(drules.argb(c["stroke_color"])) for z, c in captions.items() if drules.argb(c["stroke_color"]) != 0
    }
    if halos:
        paint["text-halo-color"] = step_expression(halos)
        paint["text-halo-width"] = HALO_WIDTH
    return paint


def caption_layer(
    drules: Drules, om_type: str, source_layer: str, layer_filter: list, along_line: bool = False
) -> tuple[int, dict] | None:
    """Names: point captions (places, water) or text along a line (streets, rivers)."""
    kind = "path_text" if along_line else "caption"
    rules = {z: getattr(e, kind) for z, e in by_zoom(drules, om_type).items() if getattr(e, kind)}
    captions = {z: rule["primary"] for z, rule in rules.items() if "primary" in rule}
    if not captions:
        return None
    priority = rules[min(captions)]["priority"]
    layout: dict = {
        "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
        "text-font": FONT,
        "text-size": width_expression({z: c["height"] for z, c in captions.items()}),
        "text-max-width": 8,
        "text-optional": True,
    }
    if along_line:
        layout.update({"symbol-placement": "line", "text-rotation-alignment": "map", "symbol-spacing": 350})
    return (
        priority,
        {
            "id": f"{om_type}:{kind}",
            "type": "symbol",
            "source": "openmaptiles",
            "source-layer": source_layer,
            "filter": layer_filter,
            "minzoom": ml_zoom(min(captions)),
            "maxzoom": MAX_ZOOM + 1,
            "layout": layout,
            "paint": text_paint(drules, captions),
        },
    )


def icon_layer(drules: Drules, om_type: str, source_layer: str, layer_filter: list) -> tuple[int, dict] | None:
    """A landmark: icon, with its name under it (caption offset_y > 0 means below)."""
    zooms = by_zoom(drules, om_type)
    symbols = {z: e.symbol for z, e in zooms.items() if e.symbol}
    if not symbols:
        return None
    captions = {z: e.caption["primary"] for z, e in zooms.items() if e.caption and "primary" in e.caption}
    priority = symbols[min(symbols)]["priority"]
    layout: dict = {
        "icon-image": step_expression({z: s["name"] for z, s in symbols.items()}),
        "icon-padding": 2,
        "symbol-sort-key": -priority,
    }
    paint: dict = {}
    if captions:
        layout.update(
            {
                "text-field": ["step", ["zoom"], "", ml_zoom(min(captions)), ["coalesce", ["get", "name:en"], ["get", "name"]]],
                "text-font": FONT,
                "text-size": width_expression({z: c["height"] for z, c in captions.items()}),
                "text-anchor": "top",
                "text-offset": [0, 0.8],
                "text-max-width": 8,
                "text-optional": True,
            }
        )
        paint = text_paint(drules, captions)
    return (
        priority,
        {
            "id": f"{om_type}:icon",
            "type": "symbol",
            "source": "openmaptiles",
            "source-layer": source_layer,
            "filter": layer_filter,
            "minzoom": ml_zoom(min(symbols)),
            "maxzoom": MAX_ZOOM + 1,
            "layout": layout,
            "paint": paint,
        },
    )


# ---------------------------------------------------------------- OpenMapTiles → Organic Maps types


def eq(key: str, value) -> list:
    return ["==", ["get", key], value]


def any_of(key: str, values: list) -> list:
    return ["in", ["get", key], ["literal", values]]


def not_bridge_or_tunnel() -> list:
    return ["!", any_of("brunnel", ["bridge", "tunnel"])]


ROAD_CLASSES = {
    # OpenMapTiles class → Organic Maps highway type ("minor" covers residential and unclassified)
    "motorway": "motorway",
    "trunk": "trunk",
    "primary": "primary",
    "secondary": "secondary",
    "tertiary": "tertiary",
    "minor": "residential",
    "service": "service",
    "track": "track",
}
PATH_SUBCLASSES = {
    "footway": "footway",
    "cycleway": "cycleway",
    "path": "path",
    "steps": "steps",
    "pedestrian": "pedestrian",
    "bridleway": "bridleway",
}
RAIL_SUBCLASSES = {"rail": "railway-rail", "light_rail": "railway-light_rail", "subway": "railway-subway", "tram": "railway-tram"}

LANDCOVER = [
    (eq("class", "wood"), "landuse-forest"),
    (any_of("subclass", ["grass", "flowerbed"]), "landuse-grass"),
    (any_of("subclass", ["grassland", "scrub"]), "natural-grassland"),
    (eq("subclass", "meadow"), "landuse-meadow"),
    (eq("subclass", "park"), "leisure-park"),
    (eq("subclass", "garden"), "leisure-garden"),
    (eq("subclass", "golf_course"), "leisure-golf_course"),
    (eq("subclass", "recreation_ground"), "landuse-recreation_ground"),
    (eq("class", "farmland"), "landuse-farmland"),
    (eq("class", "wetland"), "natural-wetland"),
    (eq("class", "sand"), "natural-beach-sand"),
]
LANDUSE = {
    "residential": "landuse-residential",
    "commercial": "landuse-commercial",
    "retail": "landuse-retail",
    "industrial": "landuse-industrial",
    "garages": "landuse-garages",
    "railway": "landuse-railway",
    "cemetery": "landuse-cemetery",
    "military": "landuse-military",
    "school": "amenity-school",
    "kindergarten": "amenity-kindergarten",
    "college": "amenity-college",
    "university": "amenity-university",
    "hospital": "amenity-hospital",
    "library": "amenity-library",
    "pitch": "leisure-pitch",
    "playground": "leisure-playground",
    "track": "leisure-track-area",
    "stadium": "leisure-stadium",
    "grass": "landuse-grass",
    "zoo": "tourism-zoo",
    "theme_park": "tourism-theme_park",
}
PARKS = {"national_park": "boundary-national_park", "nature_reserve": "leisure-nature_reserve", "protected_area": "boundary-protected_area"}
WATERWAYS = ["river", "stream", "canal", "ditch", "drain"]
PLACES = {
    "state": "place-state",
    "city": "place-city",
    "town": "place-town",
    "village": "place-village",
    "hamlet": "place-hamlet",
    "suburb": "place-suburb",
    "quarter": "place-quarter",
    "neighbourhood": "place-neighbourhood",
}
# Base-map points of interest we keep: landmarks only. Shops, restaurants,
# banks, gas stations... are left out so no chain shows; our own pins are
# the only businesses on the map. (poi subclass → Organic Maps type)
LANDMARKS = {
    "school": "amenity-school",
    "kindergarten": "amenity-kindergarten",
    "college": "amenity-college",
    "university": "amenity-university",
    "hospital": "amenity-hospital",
    "library": "amenity-library",
    "place_of_worship": "amenity-place_of_worship",
    "townhall": "amenity-townhall",
    "community_centre": "amenity-community_centre",
    "courthouse": "amenity-courthouse",
    "police": "amenity-police",
    "fire_station": "amenity-fire_station",
    "post_office": "amenity-post_office",
    "theatre": "amenity-theatre",
    "arts_centre": "amenity-arts_centre",
    "museum": "tourism-museum",
    "gallery": "tourism-gallery",
    "attraction": "tourism-attraction",
    "zoo": "tourism-zoo",
    "viewpoint": "tourism-viewpoint",
    "park": "leisure-park",
    "playground": "leisure-playground",
    "stadium": "leisure-stadium",
    "sports_centre": "leisure-sports_centre",
    "swimming_pool": "leisure-swimming_pool",
    "golf_course": "leisure-golf_course",
    "nature_reserve": "leisure-nature_reserve",
    "garden": "leisure-garden",
    "monument": "historic-monument",
    "memorial": "historic-memorial",
    "station": "railway-station",
    "subway": "railway-station-subway",
    "bus_station": "amenity-bus_station",
}


def base_layers(drules: Drules) -> list[tuple[int, dict]]:
    """Every OpenMapTiles feature we draw, as (priority, MapLibre layer)."""
    geometry: list[tuple[int, dict]] = []
    labels: list[tuple[int, dict]] = []

    def add_area(om_type, source_layer, layer_filter):
        geometry.extend(area_layers(drules, om_type, source_layer, layer_filter))

    def add_lines(om_type, source_layer, layer_filter):
        geometry.extend(line_layers(drules, om_type, source_layer, layer_filter))

    def add_label(layer):
        if layer:
            labels.append(layer)

    # Water
    add_area("natural-water", "water", ["!=", ["get", "class"], "swimming_pool"])
    add_area("leisure-swimming_pool", "water", eq("class", "swimming_pool"))
    for waterway in WATERWAYS:
        add_lines(f"waterway-{waterway}", "waterway", ["all", eq("class", waterway), ["!=", ["get", "brunnel"], "tunnel"]])
        add_label(caption_layer(drules, f"waterway-{waterway}", "waterway", eq("class", waterway), along_line=True))
    add_label(caption_layer(drules, "natural-water", "water_name", ["has", "name"]))

    # Land
    for layer_filter, om_type in LANDCOVER:
        add_area(om_type, "landcover", layer_filter)
    for value, om_type in LANDUSE.items():
        add_area(om_type, "landuse", eq("class", value))
    for value, om_type in PARKS.items():
        add_area(om_type, "park", eq("class", value))
        add_lines(om_type, "park", eq("class", value))
    add_area("building", "building", ["all"])

    # Airports
    for value in ("aerodrome", "apron", "runway", "taxiway"):
        om_type = f"aeroway-{value}"
        add_area(om_type, "aeroway", ["all", eq("class", value), ["==", ["geometry-type"], "Polygon"]])
        add_lines(om_type, "aeroway", ["all", eq("class", value), ["==", ["geometry-type"], "LineString"]])

    # Boundaries
    add_lines("boundary-administrative-4", "boundary", ["all", eq("admin_level", 4), ["!=", ["get", "maritime"], 1]])
    add_lines("boundary-administrative-2", "boundary", ["all", eq("admin_level", 2), ["!=", ["get", "maritime"], 1]])

    # Roads and paths, with their bridge, tunnel and ramp ("_link") variants
    def roads(om_base: str, base_filter: list, label_filter: list | None = None):
        variants = [("", not_bridge_or_tunnel()), ("-bridge", eq("brunnel", "bridge")), ("-tunnel", eq("brunnel", "tunnel"))]
        for suffix, brunnel in variants:
            add_lines(f"{om_base}{suffix}", "transportation", ["all", base_filter, brunnel, ["!=", ["get", "ramp"], 1]])
            if om_base.startswith("highway-") and f"{om_base}_link{suffix}" in drules.types:
                add_lines(f"{om_base}_link{suffix}", "transportation", ["all", base_filter, brunnel, eq("ramp", 1)])
        if label_filter is not None:
            add_label(caption_layer(drules, om_base, "transportation_name", label_filter, along_line=True))

    for omt_class, om_class in ROAD_CLASSES.items():
        roads(f"highway-{om_class}", eq("class", omt_class), eq("class", omt_class))
    for omt_subclass, om_class in PATH_SUBCLASSES.items():
        roads(
            f"highway-{om_class}",
            ["all", eq("class", "path"), eq("subclass", omt_subclass)],
            ["all", eq("class", "path"), eq("subclass", omt_subclass)],
        )
    for omt_subclass, om_type in RAIL_SUBCLASSES.items():
        roads(om_type, ["all", any_of("class", ["rail", "transit"]), eq("subclass", omt_subclass)])

    # Place names and landmarks
    for omt_class, om_type in PLACES.items():
        add_label(caption_layer(drules, om_type, "place", eq("class", omt_class)))
    for subclass, om_type in LANDMARKS.items():
        add_label(icon_layer(drules, om_type, "poi", eq("subclass", subclass)))

    geometry.sort(key=lambda item: item[0])
    labels.sort(key=lambda item: item[0])
    return geometry + labels


def build_style(drules: Drules) -> dict:
    layers = [{"id": "background", "type": "background", "paint": {"background-color": BACKGROUND[drules.variant]}}]
    seen: dict[str, int] = {}
    for _, layer in base_layers(drules):
        # One Organic Maps type can be fed by two tile layers (grass from landcover and landuse)
        count = seen.get(layer["id"], 0)
        seen[layer["id"]] = count + 1
        if count:
            layer["id"] = f"{layer['id']}:{layer['source-layer']}"
        layers.append(layer)
    return {
        "version": 8,
        "name": f"Organic Maps {drules.variant} (from drules_default.bin)",
        "sources": {
            "openmaptiles": {
                "type": "vector",
                "url": TILES_URL,
                "attribution": (
                    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
                    'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> '
                    'and <a href="https://organicmaps.app" target="_blank">Organic Maps</a>'
                ),
            }
        },
        "sprite": "/map/sprite" if drules.variant == "light" else f"/map/sprite-{drules.variant}",
        "glyphs": GLYPHS_URL,
        "layers": layers,
    }


def build_sprites(variant: str) -> None:
    """Organic Maps' icon atlas (symbols.xml + symbols.png) → MapLibre sprite JSON."""
    name = "sprite" if variant == "light" else f"sprite-{variant}"
    for suffix, density in SPRITES.items():
        folder = RAW / "symbols" / density / variant
        tree = ET.parse(folder / "symbols.xml")
        ratio = 1 if suffix == "" else 2
        index = {}
        for symbol in tree.iter("symbol"):
            left, top = int(symbol.get("minX")), int(symbol.get("minY"))
            index[symbol.get("name")] = {
                "x": left,
                "y": top,
                "width": int(symbol.get("maxX")) - left,
                "height": int(symbol.get("maxY")) - top,
                "pixelRatio": ratio,
            }
        (OUT / f"{name}{suffix}.json").write_text(json.dumps(index, separators=(",", ":")))
        shutil.copyfile(folder / "symbols.png", OUT / f"{name}{suffix}.png")


def business_types(drules: Drules) -> dict:
    """What Organic Maps draws for every shop/amenity/craft type: icon,
    priority, zoom it appears from, caption size. The export puts these on
    each business (pipeline/load/export_site_data.py)."""
    types = {}
    for om_type, elements in drules.types.items():
        # "shop" and "craft" alone are the fallbacks for values Organic Maps has no rule for
        if om_type not in ("shop", "craft") and not om_type.startswith(
            ("shop-", "amenity-", "craft-", "leisure-", "office-", "healthcare-", "tourism-")
        ):
            continue
        symbols = [e for e in elements if e.symbol]
        if not symbols:
            continue
        first = symbols[0]
        caption = next((e.caption["primary"] for e in elements if e.caption and "primary" in e.caption), None)
        types[om_type] = {
            "icon": first.symbol["name"],
            "priority": first.symbol["priority"],
            "zoom": first.zoom,
            "caption": caption["height"] if caption else None,
        }
    return types


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apk", type=Path, help="Organic Maps APK to extract drules and icons from")
    args = parser.parse_args()
    if args.apk:
        extract_from_apk(args.apk.expanduser())
    if not (RAW / "drules_default.bin").exists():
        if (OUT / "style.json").exists():
            print(f"No drules in {RAW}; keeping the committed style in {OUT.relative_to(ROOT)}")
            return
        raise SystemExit(f"No drules in {RAW}. Run once with --apk path/to/organicmaps.apk")

    drules = decode((RAW / "drules_default.bin").read_bytes())
    OUT.mkdir(parents=True, exist_ok=True)
    for variant in VARIANTS:
        drules.variant = variant
        style = build_style(drules)
        name = "style.json" if variant == "light" else f"style-{variant}.json"
        (OUT / name).write_text(json.dumps(style, separators=(",", ":")))
        build_sprites(variant)
    drules.variant = "light"
    types = business_types(drules)
    (OUT / "types.json").write_text(json.dumps(types, separators=(",", ":"), sort_keys=True))

    sprite = json.loads((OUT / "sprite.json").read_text())
    missing = sorted(
        {
            name
            for layer in style["layers"]
            if layer["type"] == "symbol" and "icon-image" in layer.get("layout", {})
            for name in json.dumps(layer["layout"]["icon-image"]).split('"')
            if name.endswith(("-m", "-s", "-l", "-xs"))
        }
        - set(sprite)
    )
    print(f"{len(drules.types)} Organic Maps types decoded, {len(style['layers'])} map layers")
    print(f"{len(sprite)} icons, {len(types)} business-like types")
    if missing:
        print(f"Icons named by rules but not in the atlas: {missing}")


if __name__ == "__main__":
    main()
