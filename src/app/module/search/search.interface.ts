import type { toListingCard } from "../listing/listing.service";

export type TListingCard = ReturnType<typeof toListingCard>;

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

/*
 * Search filters with slugs resolved to ids (search.service resolveSearchFilters).
 * Shared by /search/listings and the saved-search alert matcher.
 */
export interface IResolvedSearchFilters {
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
}

export interface ISearchListingsInput extends IResolvedSearchFilters {
  // restrict to these listings (alert matching checks one listing at a time)
  listingIds?: string[];
  sortBy: TSearchSort;
  limit: number;
  skip: number;
}

// ============================================
// Homepage
// ============================================

export interface IFeaturedCandidate {
  id: string;
  views: number;
  saves: number; // in the activity window
  chats: number; // in the activity window
  verifiedSeller: boolean;
  hasPhoto: boolean;
  publishedAt: Date; // approvedAt, falling back to createdAt
}

export interface ICategoryCount {
  value: string;
  label: string;
  count: number;
}

export interface IHomeData {
  featured: TListingCard[];
  categories: {
    vehicleType: string | null; // slug used for the search link
    attribute: string | null; // spec key used for the search link
    items: ICategoryCount[];
  };
  brands: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    isPopular: boolean;
    count: number;
  }[];
  vehicleTypes: {
    id: string;
    name: string;
    slug: string;
    icon: string | null;
    count: number;
  }[];
  stats: {
    liveListings: number;
    verifiedSellers: number;
    districts: number;
    soldLast30Days: number;
  };
  generatedAt: string;
}
