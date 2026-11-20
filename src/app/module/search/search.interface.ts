export const SEARCH_SORT_OPTIONS = [
  "relevance",
  "newest",
  "price_asc",
  "price_desc",
  "year_desc",
  "mileage_asc",
  "nearest",
] as const;

export type TSearchSort = (typeof SEARCH_SORT_OPTIONS)[number];

/*
 * Dynamic spec filters parsed from `spec.<key>[.min|.max]=...` query params.
 */
export type TSpecFilter =
  | { kind: "range"; key: string; min?: number; max?: number }
  | { kind: "anyOf"; key: string; values: string[] } // SELECT
  | { kind: "allOf"; key: string; values: string[] } // MULTI_SELECT
  | { kind: "boolean"; key: string; value: boolean };

export interface ISearchListingsInput {
  searchTerm?: string;
  vehicleTypeId?: string;
  brandIds?: string[];
  vehicleModelIds?: string[];
  minPrice?: number;
  maxPrice?: number;
  minYear?: number;
  maxYear?: number;
  maxMileage?: number;
  conditions?: string[];
  negotiable?: boolean;
  division?: string;
  district?: string;
  near?: { lat: number; lng: number; radiusKm: number };
  specFilters: TSpecFilter[];
  sortBy: TSearchSort;
  limit: number;
  skip: number;
}
