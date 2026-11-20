import { z } from "zod";
import { SEARCH_SORT_OPTIONS } from "./search.interface";

const optionalNumber = (label: string, min = 0) =>
  z.coerce
    .number({ message: `${label} must be a number` })
    .min(min, `${label} must be at least ${min}`)
    .optional();

const commaList = z
  .string()
  .trim()
  .max(500)
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
  )
  .optional();

/*
 * Query params of GET /search/listings. `spec.*` params are parsed
 * separately against the vehicle type's attribute schema (search.utils).
 */
export const SearchListingsQueryZodSchema = z
  .object({
    searchTerm: z.string().trim().max(100, "Search is too long").optional(),
    vehicleType: z.string().trim().max(80).optional(),
    brand: commaList,
    model: commaList,
    minPrice: optionalNumber("Min price"),
    maxPrice: optionalNumber("Max price"),
    minYear: optionalNumber("Min year", 1900),
    maxYear: optionalNumber("Max year", 1900),
    maxMileage: optionalNumber("Max mileage"),
    condition: commaList.refine(
      (values) => !values || values.every((value) => ["NEW", "USED", "RECONDITIONED"].includes(value)),
      "Condition must be NEW, USED or RECONDITIONED",
    ),
    negotiable: z.enum(["true", "false"]).optional(),
    division: z.string().trim().max(40).optional(),
    district: z.string().trim().max(40).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().min(1, "Radius must be at least 1 km").max(500, "Radius can be at most 500 km").optional(),
    sortBy: z.enum(SEARCH_SORT_OPTIONS, { message: "Invalid sort option" }).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(48, "Limit can be at most 48").optional(),
  })
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: "lat and lng must be sent together",
    path: ["lat"],
  })
  .refine(
    (query) =>
      query.minPrice === undefined || query.maxPrice === undefined || query.minPrice <= query.maxPrice,
    { message: "Min price must be less than max price", path: ["minPrice"] },
  )
  .refine(
    (query) => query.minYear === undefined || query.maxYear === undefined || query.minYear <= query.maxYear,
    { message: "Min year must be before max year", path: ["minYear"] },
  );

export const SearchFiltersQueryZodSchema = z.object({
  vehicleType: z.string().trim().max(80).optional(),
});
