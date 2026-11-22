import { IPriceInsight } from "../priceInsight/priceInsight.interface";
import { TAttributeType } from "../vehicleType/vehicleType.interface";

export interface ICompareListingsQuery {
  ids: string[];
}

/*
 * The fields compared in the fixed rows and used for highlights.
 */
export interface ICompareCandidate {
  id: string;
  price: number;
  year: number;
  mileage: number;
  priceInsight: Pick<IPriceInsight, "rating" | "diffPercent"> | null;
}

export interface ICompareHighlights {
  lowestPrice: string[];
  lowestMileage: string[];
  newestYear: string[];
  // lowest price vs. its own market (only rated listings count)
  bestDeal: string[];
}

export interface ICompareSpecRow {
  key: string;
  label: string;
  group: string;
  type: TAttributeType;
  unit: string | null;
  // one value per listing, in column order; null = not given
  values: (string | null)[];
  // false when every listing has the same value (the "differences only" toggle hides it)
  isDifferent: boolean;
}
