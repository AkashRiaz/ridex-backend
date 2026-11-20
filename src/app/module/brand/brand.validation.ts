import { z } from "zod";

const SlugZodSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by -")
  .max(80, "Slug must be at most 80 characters");

const VehicleTypeIdsZodSchema = z
  .array(z.uuid("Invalid vehicle type ID"), {
    message: "Vehicle types must be a list",
  })
  .min(1, "Select at least one vehicle type")
  .transform((ids) => Array.from(new Set(ids)));

export const CreateBrandZodSchema = z.object({
  name: z
    .string({ message: "Brand name is required" })
    .trim()
    .min(1, "Brand name is required")
    .max(60, "Brand name must be at most 60 characters long"),
  slug: SlugZodSchema.optional(),
  country: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  vehicleTypeIds: VehicleTypeIdsZodSchema,
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const UpdateBrandZodSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Brand name cannot be empty")
    .max(60, "Brand name must be at most 60 characters long")
    .optional(),
  slug: SlugZodSchema.optional(),
  country: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  vehicleTypeIds: VehicleTypeIdsZodSchema.optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
