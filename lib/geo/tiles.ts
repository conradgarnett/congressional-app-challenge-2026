/*
 * Business tiles, cut the way Organic Maps' renderer cuts its map
 * (organicmaps/organicmaps, libs/drape_frontend: tile_key.cpp,
 * tile_utils.cpp CalcTilesCoverage, frontend_renderer.cpp ResolveTileKeys).
 * Written by pipeline/load/export_site_data.py, which explains the scheme.
 */

/** [west, south, east, north] in longitude/latitude */
export type Bounds = [number, number, number, number];

/** public/data/tiles.json */
export interface TileIndex {
  scheme: "organicmaps";
  /** Organic Maps zooms with tiles; past max_zoom the max_zoom tiles are reused */
  min_zoom: number;
  max_zoom: number;
  /** Stat cells per tile side, see TileStat */
  stat_cells: number;
  /** The area the pipeline covers */
  region: Bounds;
  /** Pins per tile, keyed "z/x_y"; tiles with no businesses are left out */
  tiles: Record<string, number>;
}

/** Counts for every business in one stat cell of a tile, drawn or not */
export interface TileStat {
  /** Cell column and row inside the tile, from its south-west corner */
  c: [number, number];
  /** Businesses per group */
  g: Record<string, number>;
  /** Businesses per tag, per group */
  t: Record<string, Record<string, number>>;
}

export interface TileKey {
  x: number;
  y: number;
  zoom: number;
  id: string;
}

/** Organic Maps adds this many pixels around the screen before choosing tiles (drape/constants.hpp) */
const SCREEN_EXTENSION_PX = 75;

export function inBounds([lng, lat]: number[], bounds: Bounds): boolean {
  return lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Organic Maps' Mercator: latitude stretched to -180..180 (geometry/mercator.cpp LatToY) */
export function latToY(lat: number): number {
  const sin = Math.sin((Math.min(Math.max(lat, -86), 86) * Math.PI) / 180);
  const y = (0.5 * Math.log((1 + sin) / (1 - sin)) * 180) / Math.PI;
  return Math.min(Math.max(y, -180), 180);
}

export function tileSize(zoom: number): number {
  return 360 / 2 ** (zoom - 1);
}

/**
 * Organic Maps' zoom for a MapLibre zoom: their scale is set for 256 px
 * tiles, MapLibre's for 512 px, so theirs is one higher (visual_params.cpp
 * GetDrawTileScale).
 */
export function drawZoom(mapZoom: number): number {
  return Math.round(mapZoom + 1);
}

/** The tile zoom to load: no deeper than the deepest data zoom (ClipTileZoomByMaxDataZoom) */
export function dataZoom(index: TileIndex, mapZoom: number): number {
  return Math.min(drawZoom(mapZoom), index.max_zoom);
}

/** The tiles covering the screen plus a margin, like CalcTilesCoverage; only tiles that have businesses */
export function coverage(index: TileIndex, bounds: Bounds, mapZoom: number): TileKey[] {
  const zoom = dataZoom(index, mapZoom);
  if (zoom < index.min_zoom) return [];
  // 512 px per 360 Mercator degrees at MapLibre zoom 0
  const extension = (SCREEN_EXTENSION_PX * 360) / (512 * 2 ** mapZoom);
  const minX = bounds[0] - extension;
  const maxX = bounds[2] + extension;
  const minY = latToY(bounds[1]) - extension;
  const maxY = latToY(bounds[3]) + extension;
  const size = tileSize(zoom);
  const keys: TileKey[] = [];
  for (let x = Math.floor(minX / size); x < Math.ceil(maxX / size); x++) {
    for (let y = Math.floor(minY / size); y < Math.ceil(maxY / size); y++) {
      const id = `${zoom}/${x}_${y}`;
      if (id in index.tiles) keys.push({ x, y, zoom, id });
    }
  }
  return keys;
}

/**
 * Share of a tile's stat cell inside the view, 0 to 1. Counts in view add
 * each cell's counts times this share: exact for cells wholly on or off
 * screen, a fair estimate for the thin strip of cells on the edge.
 */
export function cellShareInView(key: TileKey, column: number, row: number, cells: number, bounds: Bounds): number {
  const cell = tileSize(key.zoom) / cells;
  const west = key.x * tileSize(key.zoom) + column * cell;
  const south = key.y * tileSize(key.zoom) + row * cell;
  const width = Math.min(west + cell, bounds[2]) - Math.max(west, bounds[0]);
  const height = Math.min(south + cell, latToY(bounds[3])) - Math.max(south, latToY(bounds[1]));
  return width <= 0 || height <= 0 ? 0 : (width * height) / (cell * cell);
}
