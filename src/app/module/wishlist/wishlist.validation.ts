import { z } from "zod";

// listingId comes from the URL; validated in the controller with this schema
export const WishlistListingParamZodSchema = z.object({
  listingId: z.uuid("Invalid listing ID"),
});
