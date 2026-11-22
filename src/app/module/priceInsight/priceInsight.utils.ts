import { ListingCondition } from "../../../generated/prisma/enums";
import {
  IComparableListing,
  IComparableTier,
  IPriceInsightSubject,
  TPriceRating,
} from "./priceInsight.interface";

// ============================================
// Comparable tiers
// ============================================

/*
 * Narrowest first. The first tier with enough comparables wins.
 */
export const COMPARABLE_TIERS: IComparableTier[] = [
  { yearRange: 1, mileageRange: 0.5 },
  { yearRange: 2, mileageRange: null },
  { yearRange: 3, mileageRange: null },
];

export const MAX_YEAR_RANGE = Math.max(
  ...COMPARABLE_TIERS.map((tier) => tier.yearRange),
);

// a brand-new bike is never compared with used ones (and the reverse)
export const conditionGroup = (condition: ListingCondition) =>
  condition === ListingCondition.NEW
    ? [ListingCondition.NEW]
    : [ListingCondition.USED, ListingCondition.RECONDITIONED];

/*
 * Mileage close enough to the subject. Relative to the larger of the two,
 * with a 5,000 km floor so nearly-new bikes (0 vs 800 km) still match.
 */
const isMileageClose = (
  subjectMileage: number,
  mileage: number,
  range: number,
) => {
  const base = Math.max(subjectMileage, mileage, 5000);
  return Math.abs(subjectMileage - mileage) <= base * range;
};

export const matchesTier = (
  subject: IPriceInsightSubject,
  candidate: IComparableListing,
  tier: IComparableTier,
) =>
  Math.abs(candidate.year - subject.year) <= tier.yearRange &&
  (tier.mileageRange === null ||
    isMileageClose(subject.mileage, candidate.mileage, tier.mileageRange));

export const pickComparableTier = (
  subject: IPriceInsightSubject,
  candidates: IComparableListing[],
  minSample: number,
) => {
  const pool = candidates.filter((candidate) => candidate.id !== subject.id);

  for (const tier of COMPARABLE_TIERS) {
    const comparables = pool.filter((candidate) =>
      matchesTier(subject, candidate, tier),
    );

    // outliers are dropped before counting, so junk prices cannot fill a tier
    const kept = new Set(trimOutliers(comparables.map((item) => item.price)));
    const trimmed = comparables.filter((item) => kept.has(item.price));

    if (trimmed.length >= minSample) {
      const years = trimmed.map((item) => item.year);

      return {
        tier,
        prices: trimmed.map((item) => item.price),
        // the years actually compared against (never future years)
        yearSpan: { from: Math.min(...years), to: Math.max(...years) },
      };
    }
  }

  return null;
};

// ============================================
// Statistics
// ============================================

/*
 * Linear interpolation between closest ranks (same as Excel PERCENTILE.INC).
 */
export const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

export const median = (values: number[]) => percentile(values, 0.5);

// prices below 0.4× or above 2.5× the raw median are typos or parts listings
const OUTLIER_LOW = 0.4;
const OUTLIER_HIGH = 2.5;

export const trimOutliers = (prices: number[]) => {
  const raw = median(prices);

  if (raw === null) return [];

  return prices.filter(
    (price) => price >= raw * OUTLIER_LOW && price <= raw * OUTLIER_HIGH,
  );
};

// ============================================
// Rating
// ============================================

export const diffFromMedian = (price: number, medianPrice: number) =>
  Math.round(((price - medianPrice) / medianPrice) * 1000) / 10;

/*
 * dealPercent below the median → GOOD_DEAL, dealPercent above → HIGH.
 * The bounds are inclusive: exactly 10% below is a good deal.
 */
export const rateListingPrice = (
  price: number,
  medianPrice: number,
  dealPercent: number,
): Exclude<TPriceRating, "INSUFFICIENT_DATA"> => {
  const diff = ((price - medianPrice) / medianPrice) * 100;

  if (diff <= -dealPercent) return "GOOD_DEAL";
  if (diff >= dealPercent) return "HIGH";
  return "FAIR";
};

// "2021–2023", or "2022" when every comparable is from one year
export const formatYearSpan = (span: { from: number; to: number }) =>
  span.from === span.to ? String(span.from) : `${span.from}–${span.to}`;

// money shown to buyers is rounded to the nearest 100
export const roundPrice = (value: number | null) =>
  value === null ? null : Math.round(value / 100) * 100;
