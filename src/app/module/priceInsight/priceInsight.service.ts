import httpStatus from "http-status";
import {
  ListingCondition,
  ListingStatus,
} from "../../../generated/prisma/enums";
import { config } from "../../config";
import { isUuid } from "../../helper/isUuid";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { PUBLIC_STATUSES, isStaff } from "../listing/listing.utils";
import { IPriceInsight } from "./priceInsight.interface";
import {
  MAX_YEAR_RANGE,
  conditionGroup,
  diffFromMedian,
  formatYearSpan,
  median,
  percentile,
  pickComparableTier,
  rateListingPrice,
  roundPrice,
} from "./priceInsight.utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Everything needed to rate one listing.
 */
export const priceInsightSelect = {
  id: true,
  price: true,
  year: true,
  mileage: true,
  condition: true,
  vehicleTypeId: true,
  vehicleModelId: true,
  brand: { select: { name: true } },
  vehicleModel: { select: { name: true } },
} as const;

type TPriceInsightRow = {
  id: string;
  price: unknown;
  year: number;
  mileage: number;
  condition: ListingCondition;
  vehicleTypeId: string;
  vehicleModelId: string | null;
  brand: { name: string };
  vehicleModel: { name: string } | null;
};

// the price is part of the key, so a price change never serves a stale rating
const cacheKey = (listingId: string, price: number) =>
  `price-insight:${listingId}:${price}`;

const conditionLabel = (condition: ListingCondition) =>
  condition === ListingCondition.NEW ? "new" : "used";

const buildPriceInsight = async (
  listing: TPriceInsightRow,
): Promise<IPriceInsight> => {
  const price = Number(listing.price);
  const generatedAt = new Date().toISOString();

  const empty = (
    reason: IPriceInsight["reason"],
    sampleSize = 0,
  ): IPriceInsight => ({
    listingId: listing.id,
    rating: "INSUFFICIENT_DATA",
    reason,
    price,
    median: null,
    p25: null,
    p75: null,
    diffPercent: null,
    sampleSize,
    basis: null,
    generatedAt,
  });

  // without a model there is nothing fair to compare against
  if (!listing.vehicleModelId || !listing.vehicleModel) {
    return empty("NO_MODEL");
  }

  const soldSince = new Date(
    Date.now() - config.price_insight_sold_lookback_days * DAY_MS,
  );

  // widest tier in one query; narrower tiers are filtered in memory
  const candidates = await prisma.listing.findMany({
    where: {
      id: { not: listing.id },
      isDeleted: false,
      vehicleTypeId: listing.vehicleTypeId,
      vehicleModelId: listing.vehicleModelId,
      condition: { in: conditionGroup(listing.condition) },
      year: {
        gte: listing.year - MAX_YEAR_RANGE,
        lte: listing.year + MAX_YEAR_RANGE,
      },
      OR: [
        { status: ListingStatus.APPROVED },
        { status: ListingStatus.SOLD, soldAt: { gte: soldSince } },
      ],
    },
    select: { id: true, price: true, year: true, mileage: true },
  });

  const picked = pickComparableTier(
    {
      id: listing.id,
      price,
      year: listing.year,
      mileage: listing.mileage,
      condition: listing.condition,
    },
    candidates.map((candidate) => ({
      ...candidate,
      price: Number(candidate.price),
    })),
    config.price_insight_min_sample,
  );

  if (!picked) {
    return empty("TOO_FEW_COMPARABLES", candidates.length);
  }

  const medianPrice = median(picked.prices) as number;

  return {
    listingId: listing.id,
    rating: rateListingPrice(
      price,
      medianPrice,
      config.price_insight_deal_percent,
    ),
    reason: null,
    price,
    median: roundPrice(medianPrice),
    p25: roundPrice(percentile(picked.prices, 0.25)),
    p75: roundPrice(percentile(picked.prices, 0.75)),
    diffPercent: diffFromMedian(price, medianPrice),
    sampleSize: picked.prices.length,
    basis: `${listing.brand.name} ${listing.vehicleModel.name} · ${formatYearSpan(picked.yearSpan)} · ${conditionLabel(listing.condition)}`,
    generatedAt,
  };
};

/*
 * Cached rating for a listing row (also used by compare).
 * Cache failures fall back to computing; they never fail the request.
 */
export const getPriceInsightForRow = async (
  listing: TPriceInsightRow,
): Promise<IPriceInsight> => {
  const ttl = config.price_insight_cache_seconds;
  const key = cacheKey(listing.id, Number(listing.price));

  if (ttl > 0) {
    try {
      const cached = await redisClient.get(key);
      if (cached) return JSON.parse(cached) as IPriceInsight;
    } catch (error) {
      console.error("Price insight cache read failed:", error);
    }
  }

  const result = await buildPriceInsight(listing);

  if (ttl > 0) {
    try {
      await redisClient.set(key, JSON.stringify(result), {
        expiration: { type: "EX", value: ttl },
      });
    } catch (error) {
      console.error("Price insight cache write failed:", error);
    }
  }

  return result;
};

/*
 * GET /price-insights/listings/:idOrSlug
 * Same visibility as the listing detail: public for live and sold listings,
 * owner and staff for the rest (so sellers can check a draft's price).
 */
const getListingPriceInsight = async (
  idOrSlug: string,
  viewer: RequestUser | undefined,
) => {
  const listing = await prisma.listing.findFirst({
    where: {
      ...(isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      isDeleted: false,
    },
    select: { ...priceInsightSelect, sellerId: true, status: true },
  });

  const canSeeUnpublished = Boolean(
    viewer &&
      listing &&
      (listing.sellerId === viewer.userId || isStaff(viewer.role)),
  );

  if (
    !listing ||
    (!PUBLIC_STATUSES.includes(listing.status) && !canSeeUnpublished)
  ) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  return getPriceInsightForRow(listing);
};

export const PriceInsightService = {
  getListingPriceInsight,
};
