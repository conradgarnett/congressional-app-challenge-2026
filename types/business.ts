import type { Feature, FeatureCollection, Point } from "geojson";

import type { TileStat } from "@/lib/geo/tiles";

export type GroupId = "food" | "groceries" | "personal_care" | "services" | "shopping";

/** A small business as written by pipeline/load/export_site_data.py. */
export interface Business {
  id: string;
  name: string;
  group: GroupId;
  /** OSM category, e.g. "shop=hairdresser" */
  category: string;
  cuisine?: string;
  hours?: string;
  phone?: string;
  website?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  postcode?: string;
  /** Link to an online menu, when OSM has one */
  menu?: string;
  /** From pipeline/load/tagging.py: ";pizza;italian;restaurant;takeout;" */
  tags?: string;
  /** How much the map knows (website, hours, tags...); wins pin space */
  rank?: number;
  /** Organic Maps zoom where the pin first shows among all businesses (the pipeline's scale index) */
  z?: number;
  /** Same, within its own group, for when a category tab is open */
  gz?: number;
}

export type BusinessFeature = Feature<Point, Business>;
export type BusinessCollection = FeatureCollection<Point, Business>;

/** One tile file: GeoJSON plus, below the deepest zoom, counts of every business in it */
export interface BusinessTile extends BusinessCollection {
  stats?: TileStat[];
}
