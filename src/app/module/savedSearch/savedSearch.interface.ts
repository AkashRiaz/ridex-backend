import {
  SavedSearchAlertFrequency,
  SavedSearchMatchKind,
} from "../../../generated/prisma/enums";

// canonical /search/listings params, e.g. { brand: "honda,yamaha", maxPrice: "300000" }
export type TSavedSearchQuery = Record<string, string>;

export interface ICreateSavedSearchPayload {
  name?: string;
  query: Record<string, string | number | boolean>;
  alertFrequency?: SavedSearchAlertFrequency;
  notifyPriceDrops?: boolean;
}

export interface IUpdateSavedSearchPayload {
  name?: string;
  alertFrequency?: SavedSearchAlertFrequency;
  notifyPriceDrops?: boolean;
}

// one readable filter, e.g. { key: "maxPrice", label: "Under BDT 3,00,000" }
export interface ISavedSearchChip {
  key: string;
  label: string;
}

/*
 * Display names for the slugs / ids inside saved queries.
 */
export interface ISavedSearchLookups {
  vehicleTypes: Map<
    string,
    {
      name: string;
      attributes: {
        key: string;
        label: string;
        type: string;
        unit?: string;
        options?: { value: string; label: string }[];
      }[];
    }
  >;
  brands: Map<string, string>;
  models: Map<string, string>;
}

// ============================================
// Alerts
// ============================================

// BullMQ job payload (saved-search queue, "match-listing")
export interface ISavedSearchMatchJob {
  listingId: string;
  kind: SavedSearchMatchKind;
  oldPrice?: number;
  newPrice?: number;
}

export interface ISavedSearchMatchedEvent {
  savedSearchId: string;
  userId: string;
  savedSearchName: string;
  kind: SavedSearchMatchKind;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  price: number;
  oldPrice: number | null;
}

export interface ISavedSearchDigestEvent {
  savedSearchId: string;
  userId: string;
  savedSearchName: string;
  newListings: number;
  priceDrops: number;
  // up to 3 listing titles for the notification body
  sampleTitles: string[];
}
