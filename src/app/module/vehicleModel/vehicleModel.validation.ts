import { z } from "zod";

const currentYear = new Date().getFullYear();

const YearZodSchema = z.coerce
  .number({ message: "Year must be a number" })
  .int("Year must be a whole number")
  .min(1950, "Year must be 1950 or later")
  .max(currentYear + 1, `Year must be ${currentYear + 1} or earlier`);

const SlugZodSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase words separated by -",
  )
  .max(80, "Slug must be at most 80 characters");

// shape is checked against the vehicle type's attribute schema in the service
const DefaultSpecsZodSchema = z.record(z.string(), z.unknown(), {
  message: "Default specs must be an object",
});

const yearRangeRefine = <
  T extends { yearFrom?: number | null; yearTo?: number | null },
>(
  data: T,
) => !data.yearFrom || !data.yearTo || data.yearFrom <= data.yearTo;

export const CreateVehicleModelZodSchema = z
  .object({
    brandId: z.uuid("Invalid brand ID"),
    vehicleTypeId: z.uuid("Invalid vehicle type ID"),
    name: z
      .string({ message: "Model name is required" })
      .trim()
      .min(1, "Model name is required")
      .max(80, "Model name must be at most 80 characters long"),
    slug: SlugZodSchema.optional(),
    yearFrom: YearZodSchema.optional(),
    yearTo: YearZodSchema.optional(),
    defaultSpecs: DefaultSpecsZodSchema.default({}),
    isActive: z.boolean().default(true),
  })
  .refine(yearRangeRefine, {
    message: "Year from must be before year to",
    path: ["yearTo"],
  });

export const UpdateVehicleModelZodSchema = z
  .object({
    brandId: z.uuid("Invalid brand ID").optional(),
    vehicleTypeId: z.uuid("Invalid vehicle type ID").optional(),
    name: z
      .string()
      .trim()
      .min(1, "Model name cannot be empty")
      .max(80, "Model name must be at most 80 characters long")
      .optional(),
    slug: SlugZodSchema.optional(),
    yearFrom: YearZodSchema.nullable().optional(),
    yearTo: YearZodSchema.nullable().optional(),
    defaultSpecs: DefaultSpecsZodSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(yearRangeRefine, {
    message: "Year from must be before year to",
    path: ["yearTo"],
  });
