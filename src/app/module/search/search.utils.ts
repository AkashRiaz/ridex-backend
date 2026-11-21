import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AppError } from "../../utils/AppError";
import {
  IAttributeOption,
  IVehicleAttribute,
} from "../vehicleType/vehicleType.interface";
import {
  ICategoryCount,
  IFeaturedCandidate,
  ISearchListingsInput,
  TSpecFilter,
} from "./search.interface";

// ============================================
// Full-text query
// ============================================

/*
 * "yamaha  r15 v4!" → "yamaha:* & r15:* & v4:*" (prefix match, every word required).
 * Only letters/marks/numbers survive, so user input can never break tsquery syntax.
 */
export const buildTsQuery = (searchTerm?: string): string | null => {
  if (!searchTerm) return null;

  const words = searchTerm
    .normalize("NFKC")
    .toLowerCase()
    // \p{M}: combining marks (Bangla vowel signs ি া ্ ...) belong to the word
    .match(/[\p{L}\p{M}\p{N}]+/gu);

  if (!words || words.length === 0) return null;

  return words
    .slice(0, 8)
    .map((word) => `${word}:*`)
    .join(" & ");
};

// ============================================
// Dynamic spec filters
// ============================================

const SPEC_PREFIX = "spec.";

/*
 * spec.engineCapacity.min=150  → range
 * spec.abs=dual-channel,single-channel → anyOf (SELECT)
 * spec.features=usb-charging,bluetooth → allOf (MULTI_SELECT)
 * spec.hasWarranty=true → boolean
 * Only filterable attributes of the selected vehicle type are accepted.
 */
export const parseSpecFilters = (
  query: Record<string, unknown>,
  attributes: IVehicleAttribute[] | null,
): TSpecFilter[] => {
  const specParams = Object.entries(query).filter(([key]) =>
    key.startsWith(SPEC_PREFIX),
  );

  if (specParams.length === 0) return [];

  if (!attributes) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Choose a vehicle type to filter by specs",
    );
  }

  const ranges = new Map<
    string,
    { kind: "range"; key: string; min?: number; max?: number }
  >();
  const filters: TSpecFilter[] = [];

  for (const [param, rawValue] of specParams) {
    const value = Array.isArray(rawValue)
      ? String(rawValue[0] ?? "")
      : String(rawValue ?? "");

    if (value.trim() === "") continue;

    const [key, bound] = param.slice(SPEC_PREFIX.length).split(".");
    const attribute = attributes.find(
      (item) => item.key === key && item.filterable,
    );

    if (!attribute) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `"${key}" is not a filterable spec`,
      );
    }

    if (attribute.type === "NUMBER") {
      if (bound !== "min" && bound !== "max") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Use spec.${key}.min or spec.${key}.max for ${attribute.label}`,
        );
      }

      const number = Number(value);

      if (!Number.isFinite(number)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `${attribute.label} filter must be a number`,
        );
      }

      const range = ranges.get(key) ?? { kind: "range" as const, key };
      range[bound] = number;
      ranges.set(key, range);
      continue;
    }

    if (bound) {
      throw new AppError(httpStatus.BAD_REQUEST, `Unknown filter "${param}"`);
    }

    if (attribute.type === "BOOLEAN") {
      if (value !== "true" && value !== "false") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `${attribute.label} filter must be true or false`,
        );
      }

      filters.push({ kind: "boolean", key, value: value === "true" });
      continue;
    }

    const allowed = (attribute.options ?? []).map((option) => option.value);
    const values = Array.from(
      new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).slice(0, 20);

    const invalid = values.find((item) => !allowed.includes(item));

    if (invalid) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `"${invalid}" is not a valid ${attribute.label} option`,
      );
    }

    filters.push({
      kind: attribute.type === "MULTI_SELECT" ? "allOf" : "anyOf",
      key,
      values,
    });
  }

  return [...filters, ...ranges.values()];
};

const specFilterToSql = (filter: TSpecFilter): Prisma.Sql => {
  switch (filter.kind) {
    case "range": {
      const conditions: Prisma.Sql[] = [
        Prisma.sql`jsonb_typeof(l."specs" -> ${filter.key}) = 'number'`,
      ];

      if (filter.min !== undefined) {
        conditions.push(
          Prisma.sql`(l."specs" ->> ${filter.key})::numeric >= ${filter.min}`,
        );
      }

      if (filter.max !== undefined) {
        conditions.push(
          Prisma.sql`(l."specs" ->> ${filter.key})::numeric <= ${filter.max}`,
        );
      }

      return Prisma.sql`(${Prisma.join(conditions, " AND ")})`;
    }

    // @> containment uses the GIN (jsonb_path_ops) index
    case "anyOf":
      return Prisma.sql`(${Prisma.join(
        filter.values.map(
          (value) =>
            Prisma.sql`l."specs" @> ${JSON.stringify({ [filter.key]: value })}::jsonb`,
        ),
        " OR ",
      )})`;

    case "allOf":
      return Prisma.sql`l."specs" @> ${JSON.stringify({ [filter.key]: filter.values })}::jsonb`;

    case "boolean":
      return Prisma.sql`l."specs" @> ${JSON.stringify({ [filter.key]: filter.value })}::jsonb`;
  }
};

// ============================================
// Distance
// ============================================

const EARTH_RADIUS_KM = 6371;

const distanceSql = (lat: number, lng: number) => Prisma.sql`
  (${EARTH_RADIUS_KM} * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(l."latitude"::float8 - ${lat}::float8) / 2), 2) +
    COS(RADIANS(${lat}::float8)) * COS(RADIANS(l."latitude"::float8)) *
    POWER(SIN(RADIANS(l."longitude"::float8 - ${lng}::float8) / 2), 2)
  )))
`;

// ============================================
// Full query
// ============================================

/*
 * Builds one parameterised query that returns matching ids, the total
 * (window count) and the distance. Every value is a bound parameter.
 */
export const buildSearchSql = (input: ISearchListingsInput) => {
  const tsQuery = buildTsQuery(input.searchTerm);

  const conditions: Prisma.Sql[] = [
    Prisma.sql`l."status" = 'APPROVED'::"ListingStatus"`,
    Prisma.sql`l."isDeleted" = false`,
  ];

  if (tsQuery) {
    conditions.push(
      Prisma.sql`l."search_vector" @@ to_tsquery('simple', ${tsQuery})`,
    );
  }

  if (input.vehicleTypeId) {
    conditions.push(Prisma.sql`l."vehicleTypeId" = ${input.vehicleTypeId}`);
  }

  if (input.brandIds?.length) {
    conditions.push(Prisma.sql`l."brandId" = ANY(${input.brandIds})`);
  }

  if (input.vehicleModelIds?.length) {
    conditions.push(
      Prisma.sql`l."vehicleModelId" = ANY(${input.vehicleModelIds})`,
    );
  }

  if (input.minPrice !== undefined) {
    conditions.push(Prisma.sql`l."price" >= ${input.minPrice}`);
  }

  if (input.maxPrice !== undefined) {
    conditions.push(Prisma.sql`l."price" <= ${input.maxPrice}`);
  }

  if (input.minYear !== undefined) {
    conditions.push(Prisma.sql`l."year" >= ${input.minYear}`);
  }

  if (input.maxYear !== undefined) {
    conditions.push(Prisma.sql`l."year" <= ${input.maxYear}`);
  }

  if (input.maxMileage !== undefined) {
    conditions.push(Prisma.sql`l."mileage" <= ${input.maxMileage}`);
  }

  if (input.conditions?.length) {
    conditions.push(Prisma.sql`l."condition"::text = ANY(${input.conditions})`);
  }

  if (input.negotiable !== undefined) {
    conditions.push(Prisma.sql`l."isNegotiable" = ${input.negotiable}`);
  }

  if (input.division) {
    conditions.push(Prisma.sql`l."division" = ${input.division}`);
  }

  if (input.district) {
    conditions.push(Prisma.sql`l."district" = ${input.district}`);
  }

  for (const filter of input.specFilters) {
    conditions.push(specFilterToSql(filter));
  }

  let distance: Prisma.Sql = Prisma.sql`NULL::float8`;

  if (input.near) {
    const { lat, lng, radiusKm } = input.near;
    const latDelta = radiusKm / 111;
    const lngDelta =
      radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

    distance = distanceSql(lat, lng);

    // cheap bounding box first (uses the lat/lng index), exact distance second
    conditions.push(
      Prisma.sql`l."latitude" BETWEEN ${lat - latDelta} AND ${lat + latDelta}`,
      Prisma.sql`l."longitude" BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}`,
      Prisma.sql`${distance} <= ${radiusKm}`,
    );
  }

  const rank = tsQuery
    ? Prisma.sql`ts_rank(l."search_vector", to_tsquery('simple', ${tsQuery}))`
    : Prisma.sql`0`;

  const sortBy =
    (input.sortBy === "relevance" && !tsQuery) ||
    (input.sortBy === "nearest" && !input.near)
      ? "newest"
      : input.sortBy;

  const orderBy: Record<string, Prisma.Sql> = {
    relevance: Prisma.sql`rank DESC, l."approvedAt" DESC NULLS LAST`,
    newest: Prisma.sql`l."approvedAt" DESC NULLS LAST`,
    price_asc: Prisma.sql`l."price" ASC`,
    price_desc: Prisma.sql`l."price" DESC`,
    year_desc: Prisma.sql`l."year" DESC, l."approvedAt" DESC NULLS LAST`,
    mileage_asc: Prisma.sql`l."mileage" ASC`,
    nearest: Prisma.sql`distance ASC NULLS LAST`,
  };

  return Prisma.sql`
    SELECT
      l."id",
      COUNT(*) OVER()::int AS total,
      ${rank} AS rank,
      ${distance} AS distance
    FROM "listings" l
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${orderBy[sortBy]}, l."id" ASC
    LIMIT ${input.limit} OFFSET ${input.skip}
  `;
};

export type TSearchRow = {
  id: string;
  total: number;
  rank: number;
  distance: number | null;
};

// ============================================
// Homepage: featured ranking + category counts
// ============================================

export const FEATURED_LIMIT = 12;

// saves and chats are counted over this many days
export const FEATURED_ACTIVITY_DAYS = 30;

// new listings get a boost that fades out over this many days
const FRESHNESS_DAYS = 14;

const FRESHNESS_MAX_POINTS = 6;

const VERIFIED_SELLER_POINTS = 4;

// a listing without photos looks broken in a featured row, so photos come first
const PHOTO_POINTS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * Activity score until paid boosts arrive (Phase 2):
 * saves ×3 + chats ×2 + views ÷ 50, plus bonuses for having photos,
 * a verified seller, and freshness (fades to 0 after FRESHNESS_DAYS).
 */
export const scoreFeaturedListing = (
  candidate: IFeaturedCandidate,
  now = new Date(),
) => {
  const ageDays = Math.max(
    0,
    (now.getTime() - candidate.publishedAt.getTime()) / DAY_MS,
  );
  const freshness =
    Math.max(0, 1 - ageDays / FRESHNESS_DAYS) * FRESHNESS_MAX_POINTS;

  return (
    candidate.saves * 3 +
    candidate.chats * 2 +
    candidate.views / 50 +
    (candidate.hasPhoto ? PHOTO_POINTS : 0) +
    (candidate.verifiedSeller ? VERIFIED_SELLER_POINTS : 0) +
    freshness
  );
};

/*
 * Highest score first; ties go to the newer listing, then id (stable order).
 */
export const rankFeaturedListings = (
  candidates: IFeaturedCandidate[],
  limit = FEATURED_LIMIT,
  now = new Date(),
) =>
  candidates
    .map((candidate) => ({
      candidate,
      score: scoreFeaturedListing(candidate, now),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.candidate.publishedAt.getTime() - a.candidate.publishedAt.getTime() ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .slice(0, limit)
    .map((item) => item.candidate.id);

/*
 * Every option of the category attribute, in schema order, with its live count.
 * Values in listings that are no longer an option are ignored.
 */
export const toCategoryCounts = (
  options: IAttributeOption[],
  rows: { value: string | null; count: number }[],
): ICategoryCount[] => {
  const countByValue = new Map(
    rows
      .filter((row) => row.value !== null)
      .map((row) => [row.value as string, row.count]),
  );

  return options.map((option) => ({
    value: option.value,
    label: option.label,
    count: countByValue.get(option.value) ?? 0,
  }));
};
