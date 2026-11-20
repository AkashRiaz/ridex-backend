import { z } from "zod";

const currentYear = new Date().getFullYear();

export const LISTING_LIMITS = {
  titleMin: 10,
  titleMax: 100,
  descriptionMax: 5000,
  priceMin: 1000,
  priceMax: 100_000_000,
  mileageMax: 1_000_000,
};

const YearZodSchema = z.coerce
  .number({ message: "Year must be a number" })
  .int("Year must be a whole number")
  .min(1950, "Year must be 1950 or later")
  .max(currentYear + 1, `Year must be ${currentYear + 1} or earlier`);

/*
 * Step 1 of the wizard creates the draft.
 */
export const CreateListingDraftZodSchema = z.object({
  vehicleTypeId: z.uuid("Invalid vehicle type ID"),
  brandId: z.uuid("Invalid brand ID"),
  vehicleModelId: z.uuid("Invalid model ID").optional(),
  year: YearZodSchema,
});

/*
 * Autosave of every later step. Formats are checked here;
 * completeness (title length, price set, photos, required specs) on submit.
 */
export const UpdateListingZodSchema = z
  .object({
    vehicleTypeId: z.uuid("Invalid vehicle type ID").optional(),
    brandId: z.uuid("Invalid brand ID").optional(),
    vehicleModelId: z.uuid("Invalid model ID").nullable().optional(),
    year: YearZodSchema.optional(),
    title: z
      .string()
      .trim()
      .max(LISTING_LIMITS.titleMax, `Title must be at most ${LISTING_LIMITS.titleMax} characters`)
      .optional(),
    description: z
      .string()
      .trim()
      .max(
        LISTING_LIMITS.descriptionMax,
        `Description must be at most ${LISTING_LIMITS.descriptionMax} characters`,
      )
      .optional(),
    price: z.coerce
      .number({ message: "Price must be a number" })
      .min(LISTING_LIMITS.priceMin, `Price must be at least ${LISTING_LIMITS.priceMin}`)
      .max(LISTING_LIMITS.priceMax, "Price is too high")
      .optional(),
    isNegotiable: z.boolean().optional(),
    condition: z.enum(["NEW", "USED", "RECONDITIONED"], { message: "Invalid condition" }).optional(),
    mileage: z.coerce
      .number({ message: "Mileage must be a number" })
      .int("Mileage must be a whole number")
      .min(0, "Mileage cannot be negative")
      .max(LISTING_LIMITS.mileageMax, "Mileage is too high")
      .optional(),
    color: z.string().trim().max(30, "Color must be at most 30 characters").nullable().optional(),
    specs: z.record(z.string(), z.unknown(), { message: "Specs must be an object" }).optional(),
    videoUrl: z
      .url({ message: "Video link must be a valid URL", protocol: /^https?$/ })
      .max(300)
      .nullable()
      .optional(),
    division: z.string().trim().max(40).optional(),
    district: z.string().trim().max(40).optional(),
    area: z.string().trim().max(100, "Area must be at most 100 characters").nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .refine((data) => (data.latitude === undefined) === (data.longitude === undefined), {
    message: "Latitude and longitude must be sent together",
    path: ["latitude"],
  });

export const ReorderListingImagesZodSchema = z.object({
  order: z
    .array(z.uuid("Invalid image ID"), { message: "Order must be a list of image IDs" })
    .min(1, "Order cannot be empty"),
  coverImageId: z.uuid("Invalid cover image ID").optional(),
});

export const UpdateListingStatusZodSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"], {
      message: "Status must be APPROVED or REJECTED",
    }),
    reason: z.string().trim().max(500, "Reason must be at most 500 characters").optional(),
  })
  .refine((data) => data.status !== "REJECTED" || Boolean(data.reason), {
    message: "A reason is required when rejecting a listing",
    path: ["reason"],
  });
