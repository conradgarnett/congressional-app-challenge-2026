"""Decode Organic Maps' compiled drawing rules (drules_default.bin).

The file ships inside the Organic Maps app (assets/drules_default.bin). It
holds, for every map feature type ("highway-primary", "shop-bakery"...) and
every zoom, how to draw it: line widths and colors, area fills, the icon,
caption size and colors, and the priority that decides what wins when
things overlap.

Format: "OMDR" version 1, written by their tools/kothic and read by
libs/indexer/drules_format.cpp in organicmaps/organicmaps. This decoder is a
line-by-line port of that reader. Little-endian; varuint = LEB128;
signed = zigzag varint; f32 = IEEE bits in a u32; strings and colors are
indices into tables at the start.

Licence: the .bin is an Organic Maps Data File. Anything built from it must
show "Map data © OpenStreetMap and Organic Maps" with links (the site does).
"""

from dataclasses import dataclass, field
import struct

LINES, AREA, SYMBOL, CAPTION, PATH_TEXT, SHIELD = (1 << bit for bit in range(6))
LINE_DASHDOT, LINE_PATHSYM = 1, 2
AREA_BORDER = 1
CAPTION_PRIMARY, CAPTION_SECONDARY = 1, 2


@dataclass
class Element:
    """Draw rules for one type at one zoom."""

    zoom: int
    apply_if: list[str]
    lines: list[dict] = field(default_factory=list)
    area: dict | None = None
    symbol: dict | None = None
    caption: dict | None = None
    path_text: dict | None = None
    shield: dict | None = None


@dataclass
class Drules:
    variants: list[str]
    # colors[variant][index] = ARGB
    colors: list[list[int]]
    named_colors: dict[str, int]
    types: dict[str, list[Element]]
    # Palette that argb() reads: "light" or "dark" (same rules, different colors)
    variant: str = "light"

    def argb(self, index: int) -> int:
        return self.colors[self.variants.index(self.variant)][index]


class _Reader:
    def __init__(self, blob: bytes):
        self.blob = blob
        self.pos = 0
        self.strings: list[str] = []

    def u8(self) -> int:
        value = self.blob[self.pos]
        self.pos += 1
        return value

    def u32(self) -> int:
        (value,) = struct.unpack_from("<I", self.blob, self.pos)
        self.pos += 4
        return value

    def f32(self) -> float:
        (value,) = struct.unpack_from("<f", self.blob, self.pos)
        self.pos += 4
        return round(value, 4)

    def varuint(self) -> int:
        result = shift = 0
        while True:
            byte = self.u8()
            result |= (byte & 0x7F) << shift
            if not byte & 0x80:
                return result
            shift += 7

    def varint(self) -> int:
        value = self.varuint()
        return (value >> 1) ^ -(value & 1)

    def raw_string(self) -> str:
        length = self.varuint()
        text = self.blob[self.pos : self.pos + length].decode("utf-8")
        self.pos += length
        return text

    def string(self) -> str:
        return self.strings[self.varuint()]

    def section(self) -> int:
        size = self.varuint()
        return self.pos + size


def _line_extras(reader: _Reader, flags: int, line: dict) -> None:
    if flags & LINE_DASHDOT:
        dashes = [reader.f32() for _ in range(reader.varuint())]
        line["dashdot"] = {"dashes": dashes, "offset": reader.f32()}
    if flags & LINE_PATHSYM:
        line["pathsym"] = {"name": reader.string(), "step": reader.f32(), "offset": reader.f32()}


def _line_rule(reader: _Reader) -> dict:
    flags = reader.u8()
    line = {
        "width": reader.f32(),
        "color": reader.varuint(),
        "priority": reader.varint(),
        "join": reader.u8(),
        "cap": reader.u8(),
    }
    _line_extras(reader, flags, line)
    return line


def _line_def(reader: _Reader) -> dict:
    flags = reader.u8()
    line = {"width": reader.f32(), "color": reader.varuint(), "join": reader.u8(), "cap": reader.u8()}
    _line_extras(reader, flags, line)
    return line


def _area_rule(reader: _Reader) -> dict:
    flags = reader.u8()
    area = {"color": reader.varuint(), "priority": reader.varint()}
    if flags & AREA_BORDER:
        area["border"] = _line_def(reader)
    return area


def _caption_def(reader: _Reader) -> dict:
    return {
        "height": reader.varint(),
        "color": reader.varuint(),
        "stroke_color": reader.varuint(),
        "offset_x": reader.varint(),
        "offset_y": reader.varint(),
        "text": reader.string(),
        "optional": reader.u8() != 0,
    }


def _caption_rule(reader: _Reader) -> dict:
    flags = reader.u8()
    caption: dict = {}
    if flags & CAPTION_PRIMARY:
        caption["primary"] = _caption_def(reader)
    if flags & CAPTION_SECONDARY:
        caption["secondary"] = _caption_def(reader)
    caption["priority"] = reader.varint()
    return caption


def _element(reader: _Reader) -> Element:
    element = Element(zoom=reader.u8(), apply_if=[reader.string() for _ in range(reader.varuint())])
    kind = reader.u8()
    if kind & LINES:
        element.lines = [_line_rule(reader) for _ in range(reader.varuint())]
    if kind & AREA:
        element.area = _area_rule(reader)
    if kind & SYMBOL:
        element.symbol = {
            "name": reader.string(),
            "apply_for_type": reader.varint(),
            "priority": reader.varint(),
            "min_distance": reader.varint(),
        }
    if kind & CAPTION:
        element.caption = _caption_rule(reader)
    if kind & PATH_TEXT:
        element.path_text = _caption_rule(reader)
    if kind & SHIELD:
        element.shield = {
            "height": reader.varint(),
            "color": reader.varuint(),
            "stroke_color": reader.varuint(),
            "priority": reader.varint(),
            "min_distance": reader.varint(),
            "text_color": reader.varuint(),
            "text_stroke_color": reader.varuint(),
        }
    return element


def decode(blob: bytes) -> Drules:
    reader = _Reader(blob)
    if blob[:4] != b"OMDR" or blob[4] != 1:
        raise ValueError("Not an Organic Maps drules file (OMDR version 1)")
    reader.pos = 5
    variants = [reader.raw_string() for _ in range(reader.u8())]

    end = reader.section()
    reader.strings = [reader.raw_string() for _ in range(reader.varuint())]
    reader.pos = end

    end = reader.section()
    color_count = reader.varuint()
    colors = [[reader.u32() for _ in range(color_count)] for _ in variants]
    reader.pos = end

    end = reader.section()
    named_colors = {}
    for _ in range(reader.varuint()):
        name = reader.string()
        named_colors[name] = reader.varuint()
    reader.pos = end

    reader.pos = reader.section()  # rule counts: only used to reserve memory in C++

    end = reader.section()
    types = {}
    for _ in range(reader.varuint()):
        name = reader.string()
        types[name] = [_element(reader) for _ in range(reader.varuint())]
    reader.pos = end
    # Overrides (per-variant element replacements) are empty in shipped data; not needed here.
    return Drules(variants=variants, colors=colors, named_colors=named_colors, types=types)


def css_color(argb: int) -> str:
    """Stored ARGB → CSS. The stored alpha is transparency: opacity = 255 - alpha
    (apply_feature_functors.cpp ToDrapeColor)."""
    alpha = 255 - ((argb >> 24) & 0xFF)
    red, green, blue = (argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF
    if alpha == 255:
        return f"#{red:02x}{green:02x}{blue:02x}"
    return f"rgba({red},{green},{blue},{alpha / 255:.3f})"
