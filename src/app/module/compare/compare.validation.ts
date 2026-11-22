import { z } from "zod";
import { MAX_COMPARE_LISTINGS } from "./compare.utils";

/*
 * Query params of GET /compare. Order is kept: columns appear as sent.
 */
export const CompareListingsQueryZodSchema = z.object({
  ids: z
    .string({ message: "Choose listings to compare" })
    .trim()
    .min(1, "Choose listings to compare")
    .max(400, "Too many listings")
    .transform((value) =>
      Array.from(
        new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ),
    )
    .pipe(
      z
        .array(z.uuid("Invalid listing ID"))
        .min(1, "Choose listings to compare")
        .max(
          MAX_COMPARE_LISTINGS,
          `You can compare up to ${MAX_COMPARE_LISTINGS} listings`,
        ),
    ),
});
