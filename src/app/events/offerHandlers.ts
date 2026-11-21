import { OfferService } from "../module/offer/offer.service";
import { appEvents, safeHandler } from "./appEvents";

/*
 * Listing lifecycle → open offers on it are closed.
 * Notifications for the closed offers come from "offer.cancelled".
 */
export const registerOfferHandlers = () => {
  appEvents.on(
    "listing.sold",
    safeHandler("offer:listing.sold", async (event) => {
      await OfferService.cancelOpenOffersForListing(
        event.listingId,
        "the listing was sold",
      );
    }),
  );

  appEvents.on(
    "listing.expired",
    safeHandler("offer:listing.expired", async (event) => {
      await OfferService.cancelOpenOffersForListing(
        event.listingId,
        "the listing expired",
      );
    }),
  );

  // an edited listing that fails re-review is no longer for sale
  appEvents.on(
    "listing.rejected",
    safeHandler("offer:listing.rejected", async (event) => {
      await OfferService.cancelOpenOffersForListing(
        event.listingId,
        "the listing was taken down",
      );
    }),
  );

  appEvents.on(
    "listing.deleted",
    safeHandler("offer:listing.deleted", async (event) => {
      await OfferService.cancelOpenOffersForListing(
        event.listingId,
        "the listing was removed",
      );
    }),
  );
};
