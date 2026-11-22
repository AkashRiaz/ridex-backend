import httpStatus from "http-status";
import { ListingStatus, UserStatus } from "../../../generated/prisma/enums";
import { BD_DIVISIONS } from "../../helper/bdLocations";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { config } from "../../config";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import {
  SearchFiltersQueryZodSchema,
  SearchListingsQueryZodSchema,
  TSearchListingsQuery,
} from "./search.validation";
import {
  IFeaturedCandidate,
  IHomeData,
  IResolvedSearchFilters,
} from "./search.interface";
import {
  FEATURED_ACTIVITY_DAYS,
  FEATURED_LIMIT,
  TSearchRow,
  buildSearchSql,
  parseSpecFilters,
  rankFeaturedListings,
  toCategoryCounts,
} from "./search.utils";

const PUBLIC_LISTING = { status: ListingStatus.APPROVED, isDeleted: false };

const parseOrThrow = <T>(
  schema: {
    safeParse: (
      input: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { message: string }[] } };
  },
  input: unknown,
) => {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      result.error.issues.map((issue) => issue.message).join(", "),
    );
  }

  return result.data;
};

const findVehicleType = (idOrSlug: string) =>
  prisma.vehicleType.findFirst({
    where: {
      ...(isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      isActive: true,
    },
  });

const emptyResult = (page: number, limit: number) => ({
  data: [],
  meta: queryBuilder.buildMeta(page, limit, 0),
});

/*
 * Validates search params and resolves slugs → ids.
 * Returns filters: null when the search can have no results (unknown
 * vehicle type, brand or model), so shared links and saved searches keep
 * working after catalog changes instead of failing.
 */
export const resolveSearchFilters = async (
  rawQuery: Record<string, unknown>,
): Promise<{
  query: TSearchListingsQuery;
  filters: IResolvedSearchFilters | null;
}> => {
  const query = parseOrThrow(SearchListingsQueryZodSchema, rawQuery);

  const vehicleType = query.vehicleType
    ? await findVehicleType(query.vehicleType)
    : null;

  if (query.vehicleType && !vehicleType) return { query, filters: null };

  const attributes = vehicleType
    ? parseAttributes(vehicleType.attributes)
    : null;

  const specFilters = parseSpecFilters(rawQuery, attributes);

  let brandIds: string[] | undefined;

  if (query.brand?.length) {
    const brands = await prisma.brand.findMany({
      where: {
        OR: [
          { slug: { in: query.brand } },
          { id: { in: query.brand.filter(isUuid) } },
        ],
      },
      select: { id: true },
    });

    if (brands.length === 0) return { query, filters: null };

    brandIds = brands.map((brand) => brand.id);
  }

  let vehicleModelIds: string[] | undefined;

  if (query.model?.length) {
    const models = await prisma.vehicleModel.findMany({
      where: {
        OR: [
          { slug: { in: query.model } },
          { id: { in: query.model.filter(isUuid) } },
        ],
        ...(brandIds && { brandId: { in: brandIds } }),
      },
      select: { id: true },
    });

    if (models.length === 0) return { query, filters: null };

    vehicleModelIds = models.map((model) => model.id);
  }

  return {
    query,
    filters: {
      searchTerm: query.searchTerm,
      vehicleTypeId: vehicleType?.id,
      brandIds,
      vehicleModelIds,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      minYear: query.minYear,
      maxYear: query.maxYear,
      maxMileage: query.maxMileage,
      conditions: query.condition,
      negotiable:
        query.negotiable === undefined
          ? undefined
          : query.negotiable === "true",
      division: query.division,
      district: query.district,
      near:
        query.lat !== undefined && query.lng !== undefined
          ? { lat: query.lat, lng: query.lng, radiusKm: query.radius ?? 25 }
          : undefined,
      specFilters,
    },
  };
};

/*
 * GET /search/listings
 */
const searchListings = async (rawQuery: Record<string, unknown>) => {
  const { query, filters } = await resolveSearchFilters(rawQuery);

  const page = query.page ?? 1;
  const limit = query.limit ?? 24;

  if (!filters) return emptyResult(page, limit);

  const rows = await prisma.$queryRaw<TSearchRow[]>(
    buildSearchSql({
      ...filters,
      sortBy: query.sortBy ?? (query.searchTerm ? "relevance" : "newest"),
      limit,
      skip: (page - 1) * limit,
    }),
  );

  if (rows.length === 0) return emptyResult(page, limit);

  const listings = await prisma.listing.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: listingCardInclude,
  });

  const byId = new Map(listings.map((listing) => [listing.id, listing]));

  return {
    data: rows
      .map((row) => {
        const listing = byId.get(row.id);
        return listing
          ? toListingCard(
              listing,
              row.distance === null ? null : Math.round(row.distance * 10) / 10,
            )
          : null;
      })
      .filter((card) => card !== null),
    meta: queryBuilder.buildMeta(page, limit, Number(rows[0].total)),
  };
};

/*
 * Does this live listing match the resolved filters? Same SQL as the search page.
 */
export const listingMatchesFilters = async (
  filters: IResolvedSearchFilters,
  listingId: string,
) => {
  const rows = await prisma.$queryRaw<TSearchRow[]>(
    buildSearchSql({
      ...filters,
      listingIds: [listingId],
      sortBy: "newest",
      limit: 1,
      skip: 0,
    }),
  );

  return rows.length > 0;
};

/*
 * GET /search/filters — everything the filter sidebar needs.
 */
const getSearchFilters = async (rawQuery: Record<string, unknown>) => {
  const query = parseOrThrow(SearchFiltersQueryZodSchema, rawQuery);

  const vehicleType = query.vehicleType
    ? await findVehicleType(query.vehicleType)
    : null;

  if (query.vehicleType && !vehicleType) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  const where = {
    ...PUBLIC_LISTING,
    ...(vehicleType && { vehicleTypeId: vehicleType.id }),
  };

  const [
    vehicleTypes,
    typeCounts,
    brandCounts,
    aggregates,
    locationCounts,
    conditionCounts,
  ] = await Promise.all([
    prisma.vehicleType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true, icon: true },
    }),
    prisma.listing.groupBy({
      by: ["vehicleTypeId"],
      where: PUBLIC_LISTING,
      _count: { _all: true },
    }),
    prisma.listing.groupBy({
      by: ["brandId"],
      where,
      _count: { _all: true },
    }),
    prisma.listing.aggregate({
      where,
      _min: { price: true, year: true },
      _max: { price: true, year: true, mileage: true },
    }),
    prisma.listing.groupBy({
      by: ["division", "district"],
      where,
      _count: { _all: true },
    }),
    prisma.listing.groupBy({
      by: ["condition"],
      where,
      _count: { _all: true },
    }),
  ]);

  const brands = await prisma.brand.findMany({
    where: {
      isActive: true,
      ...(vehicleType && {
        vehicleTypes: { some: { vehicleTypeId: vehicleType.id } },
      }),
    },
    orderBy: [{ isPopular: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      isPopular: true,
    },
  });

  const brandCountById = new Map(
    brandCounts.map((item) => [item.brandId, item._count._all]),
  );
  const typeCountById = new Map(
    typeCounts.map((item) => [item.vehicleTypeId, item._count._all]),
  );
  const locationCount = new Map(
    locationCounts.map((item) => [
      `${item.division}|${item.district}`,
      item._count._all,
    ]),
  );

  return {
    vehicleTypes: vehicleTypes.map((item) => ({
      ...item,
      count: typeCountById.get(item.id) ?? 0,
    })),
    vehicleType: vehicleType
      ? {
          id: vehicleType.id,
          name: vehicleType.name,
          slug: vehicleType.slug,
          icon: vehicleType.icon,
          filterableAttributes: parseAttributes(vehicleType.attributes).filter(
            (attribute) => attribute.filterable,
          ),
        }
      : null,
    brands: brands.map((brand) => ({
      ...brand,
      count: brandCountById.get(brand.id) ?? 0,
    })),
    priceRange: {
      min:
        aggregates._min.price === null ? null : Number(aggregates._min.price),
      max:
        aggregates._max.price === null ? null : Number(aggregates._max.price),
    },
    yearRange: { min: aggregates._min.year, max: aggregates._max.year },
    maxMileage: aggregates._max.mileage,
    conditions: conditionCounts.map((item) => ({
      value: item.condition,
      count: item._count._all,
    })),
    locations: BD_DIVISIONS.map((division) => {
      const districts = division.districts.map((district) => ({
        name: district.name,
        count: locationCount.get(`${division.name}|${district.name}`) ?? 0,
      }));

      return {
        division: division.name,
        count: districts.reduce((sum, district) => sum + district.count, 0),
        districts,
      };
    }),
  };
};

// ============================================
// Homepage
// ============================================

const HOME_CACHE_KEY = "search:home";

// the homepage category tiles come from this attribute of this vehicle type
const HOME_CATEGORY_SOURCE = { vehicleType: "bike", attribute: "bikeCategory" };

const HOME_BRAND_LIMIT = 12;

// most viewed + newest are ranked together (the union is at most 2× this)
const FEATURED_POOL_SIZE = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

const getFeaturedListings = async (now: Date) => {
  const where = PUBLIC_LISTING;
  const select = {
    id: true,
    viewsCount: true,
    approvedAt: true,
    createdAt: true,
    seller: { select: { idVerifiedAt: true, dealerVerifiedAt: true } },
    _count: { select: { images: true } },
  } as const;

  // the "newest" pool lets a brand-new listing be featured before it has views
  const [popular, newest] = await Promise.all([
    prisma.listing.findMany({
      where,
      select,
      orderBy: { viewsCount: "desc" },
      take: FEATURED_POOL_SIZE,
    }),
    prisma.listing.findMany({
      where,
      select,
      orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
      take: FEATURED_POOL_SIZE,
    }),
  ]);

  const pool = [
    ...new Map([...popular, ...newest].map((item) => [item.id, item])).values(),
  ];

  if (pool.length === 0) return [];

  const ids = pool.map((item) => item.id);
  const since = new Date(now.getTime() - FEATURED_ACTIVITY_DAYS * DAY_MS);

  const [saves, chats] = await Promise.all([
    prisma.wishlistItem.groupBy({
      by: ["listingId"],
      where: { listingId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.conversation.groupBy({
      by: ["listingId"],
      where: { listingId: { in: ids }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const saveCount = new Map(
    saves.map((item) => [item.listingId, item._count._all]),
  );
  const chatCount = new Map(
    chats.map((item) => [item.listingId, item._count._all]),
  );

  const candidates: IFeaturedCandidate[] = pool.map((item) => ({
    id: item.id,
    views: item.viewsCount,
    saves: saveCount.get(item.id) ?? 0,
    chats: chatCount.get(item.id) ?? 0,
    verifiedSeller: Boolean(
      item.seller.idVerifiedAt || item.seller.dealerVerifiedAt,
    ),
    hasPhoto: item._count.images > 0,
    publishedAt: item.approvedAt ?? item.createdAt,
  }));

  const rankedIds = rankFeaturedListings(candidates, FEATURED_LIMIT, now);

  const listings = await prisma.listing.findMany({
    where: { id: { in: rankedIds } },
    include: listingCardInclude,
  });

  const byId = new Map(listings.map((listing) => [listing.id, listing]));

  return rankedIds.flatMap((id) => {
    const listing = byId.get(id);
    return listing ? [toListingCard(listing)] : [];
  });
};

const getHomeCategories = async (): Promise<IHomeData["categories"]> => {
  const vehicleType = await prisma.vehicleType.findFirst({
    where: { slug: HOME_CATEGORY_SOURCE.vehicleType, isActive: true },
    select: { id: true, slug: true, attributes: true },
  });

  const attribute = vehicleType
    ? parseAttributes(vehicleType.attributes).find(
        (item) => item.key === HOME_CATEGORY_SOURCE.attribute,
      )
    : undefined;

  if (!vehicleType || !attribute?.options?.length) {
    return { vehicleType: null, attribute: null, items: [] };
  }

  const rows = await prisma.$queryRaw<
    { value: string | null; count: number }[]
  >`
    SELECT l."specs"->>${attribute.key} AS value, COUNT(*)::int AS count
    FROM "listings" l
    WHERE l."vehicleTypeId" = ${vehicleType.id}
      AND l."status" = 'APPROVED'
      AND l."isDeleted" = false
    GROUP BY 1
  `;

  return {
    vehicleType: vehicleType.slug,
    attribute: attribute.key,
    items: toCategoryCounts(attribute.options, rows),
  };
};

const getHomeBrands = async () => {
  const [brands, counts] = await Promise.all([
    prisma.brand.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        isPopular: true,
      },
    }),
    prisma.listing.groupBy({
      by: ["brandId"],
      where: PUBLIC_LISTING,
      _count: { _all: true },
    }),
  ]);

  const countById = new Map(
    counts.map((item) => [item.brandId, item._count._all]),
  );

  return brands
    .map((brand) => ({ ...brand, count: countById.get(brand.id) ?? 0 }))
    .sort(
      (a, b) =>
        Number(b.isPopular) - Number(a.isPopular) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    )
    .slice(0, HOME_BRAND_LIMIT);
};

const getHomeStats = async (now: Date) => {
  const since = new Date(now.getTime() - FEATURED_ACTIVITY_DAYS * DAY_MS);

  const [liveListings, verifiedSellers, districts, soldRecently] =
    await Promise.all([
      prisma.listing.count({ where: PUBLIC_LISTING }),
      prisma.user.count({
        where: {
          isDeleted: false,
          status: UserStatus.ACTIVE,
          OR: [
            { idVerifiedAt: { not: null } },
            { dealerVerifiedAt: { not: null } },
          ],
        },
      }),
      prisma.listing.groupBy({
        by: ["district"],
        where: { ...PUBLIC_LISTING, district: { not: "" } },
      }),
      prisma.listing.count({
        where: {
          status: ListingStatus.SOLD,
          isDeleted: false,
          soldAt: { gte: since },
        },
      }),
    ]);

  return {
    liveListings,
    verifiedSellers,
    districts: districts.length,
    soldLast30Days: soldRecently,
  };
};

const buildHomeData = async (): Promise<IHomeData> => {
  const now = new Date();

  const [featured, categories, brands, vehicleTypes, stats] = await Promise.all(
    [
      getFeaturedListings(now),
      getHomeCategories(),
      getHomeBrands(),
      prisma.vehicleType.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          icon: true,
          _count: { select: { listings: { where: PUBLIC_LISTING } } },
        },
      }),
      getHomeStats(now),
    ],
  );

  return {
    featured,
    categories,
    brands,
    vehicleTypes: vehicleTypes.map(({ _count, ...item }) => ({
      ...item,
      count: _count.listings,
    })),
    stats,
    generatedAt: now.toISOString(),
  };
};

/*
 * GET /search/home — everything the public homepage needs in one call.
 * Cached in Redis for HOME_CACHE_SECONDS; a Redis failure falls back to the DB.
 */
const getHomeData = async (): Promise<IHomeData> => {
  const ttl = config.home_cache_seconds;

  if (ttl > 0) {
    try {
      const cached = await redisClient.get(HOME_CACHE_KEY);
      if (cached) return JSON.parse(cached) as IHomeData;
    } catch (error) {
      console.error("Home cache read failed:", error);
    }
  }

  const result = await buildHomeData();

  if (ttl > 0) {
    try {
      await redisClient.set(HOME_CACHE_KEY, JSON.stringify(result), {
        expiration: { type: "EX", value: ttl },
      });
    } catch (error) {
      console.error("Home cache write failed:", error);
    }
  }

  return result;
};

export const SearchService = {
  searchListings,
  getSearchFilters,
  getHomeData,
};
