import httpStatus from "http-status";
import { ListingStatus } from "../../../generated/prisma/enums";
import { BD_DIVISIONS } from "../../helper/bdLocations";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { listingCardInclude, toListingCard } from "../listing/listing.service";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import {
  SearchFiltersQueryZodSchema,
  SearchListingsQueryZodSchema,
} from "./search.validation";
import { TSearchRow, buildSearchSql, parseSpecFilters } from "./search.utils";

const PUBLIC_LISTING = { status: ListingStatus.APPROVED, isDeleted: false };

const parseOrThrow = <T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
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
 * GET /search/listings
 */
const searchListings = async (rawQuery: Record<string, unknown>) => {
  const query = parseOrThrow(SearchListingsQueryZodSchema, rawQuery);

  const page = query.page ?? 1;
  const limit = query.limit ?? 24;

  /*
   * Resolve slugs → ids. Unknown values mean "no results", not an error,
   * so shared links keep working after catalog changes.
   */
  const vehicleType = query.vehicleType ? await findVehicleType(query.vehicleType) : null;

  if (query.vehicleType && !vehicleType) return emptyResult(page, limit);

  const attributes = vehicleType ? parseAttributes(vehicleType.attributes) : null;

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

    if (brands.length === 0) return emptyResult(page, limit);

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

    if (models.length === 0) return emptyResult(page, limit);

    vehicleModelIds = models.map((model) => model.id);
  }

  const near =
    query.lat !== undefined && query.lng !== undefined
      ? { lat: query.lat, lng: query.lng, radiusKm: query.radius ?? 25 }
      : undefined;

  const rows = await prisma.$queryRaw<TSearchRow[]>(
    buildSearchSql({
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
      negotiable: query.negotiable === undefined ? undefined : query.negotiable === "true",
      division: query.division,
      district: query.district,
      near,
      specFilters,
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
          ? toListingCard(listing, row.distance === null ? null : Math.round(row.distance * 10) / 10)
          : null;
      })
      .filter((card) => card !== null),
    meta: queryBuilder.buildMeta(page, limit, Number(rows[0].total)),
  };
};

/*
 * GET /search/filters — everything the filter sidebar needs.
 */
const getSearchFilters = async (rawQuery: Record<string, unknown>) => {
  const query = parseOrThrow(SearchFiltersQueryZodSchema, rawQuery);

  const vehicleType = query.vehicleType ? await findVehicleType(query.vehicleType) : null;

  if (query.vehicleType && !vehicleType) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  const where = {
    ...PUBLIC_LISTING,
    ...(vehicleType && { vehicleTypeId: vehicleType.id }),
  };

  const [vehicleTypes, typeCounts, brandCounts, aggregates, locationCounts, conditionCounts] =
    await Promise.all([
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
      ...(vehicleType && { vehicleTypes: { some: { vehicleTypeId: vehicleType.id } } }),
    },
    orderBy: [{ isPopular: "desc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, logoUrl: true, isPopular: true },
  });

  const brandCountById = new Map(brandCounts.map((item) => [item.brandId, item._count._all]));
  const typeCountById = new Map(typeCounts.map((item) => [item.vehicleTypeId, item._count._all]));
  const locationCount = new Map(
    locationCounts.map((item) => [`${item.division}|${item.district}`, item._count._all]),
  );

  return {
    vehicleTypes: vehicleTypes.map((item) => ({ ...item, count: typeCountById.get(item.id) ?? 0 })),
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
    brands: brands.map((brand) => ({ ...brand, count: brandCountById.get(brand.id) ?? 0 })),
    priceRange: {
      min: aggregates._min.price === null ? null : Number(aggregates._min.price),
      max: aggregates._max.price === null ? null : Number(aggregates._max.price),
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

export const SearchService = {
  searchListings,
  getSearchFilters,
};
