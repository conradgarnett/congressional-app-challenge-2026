import type { FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";

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
  /** Added in the browser by lib/tags.ts: ";pizza;italian;restaurant;" */
  tags?: string;
}

export interface District {
  /** e.g. "MD-08", "DC-AL" */
  id: string;
  state: string;
  number: string;
  metro: boolean;
  business_count: number;
  has_data: boolean;
}

export type BusinessCollection = FeatureCollection<Point, Business>;
export type DistrictCollection = FeatureCollection<Polygon | MultiPolygon, District>;
