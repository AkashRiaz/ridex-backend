import { ListingCondition } from "../../../generated/prisma/enums";

export const PRICE_RATINGS = [
  "GOOD_DEAL",
  "FAIR",
  "HIGH",
  "INSUFFICIENT_DATA",
] as const;

export type TPriceRating = (typeof PRICE_RATINGS)[number];

// why a listing has no rating
export type TInsufficientReason = "NO_MODEL" | "TOO_FEW_COMPARABLES";

/*
 * The listing being rated (only the fields the rating needs).
 */
export interface IPriceInsightSubject {
  id: string;
  price: number;
  year: number;
  mileage: number;
  condition: ListingCondition;
}

/*
 * A comparable listing: live, or sold within the lookback window.
 */
export interface IComparableListing {
  id: string;
  price: number;
  year: number;
  mileage: number;
}

export interface IComparableTier {
  // max distance in model years
  yearRange: number;
  // max relative mileage difference (0.5 = ±50%), null = any mileage
  mileageRange: number | null;
}

export interface IPriceInsight {
  listingId: string;
  rating: TPriceRating;
  reason: TInsufficientReason | null;
  price: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  // (price − median) / median × 100, rounded to 1 decimal
  diffPercent: number | null;
  sampleSize: number;
  // human-readable comparison basis, e.g. "Yamaha R15 V4 · 2021–2023 · used"
  basis: string | null;
  generatedAt: string;
}
