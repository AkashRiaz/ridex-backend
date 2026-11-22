import { SavedSearchMatchKind } from "../../generated/prisma/enums";
import { SavedSearchService } from "../module/savedSearch/savedSearch.service";
import { appEvents, safeHandler } from "./appEvents";

/*
 * Listing lifecycle → saved-search matching (in the saved-search worker,
 * never in the request cycle). The worker emits "savedSearch.matched";
 * notifications for it live in notificationHandlers.
 */
export const registerSavedSearchHandlers = () => {
  appEvents.on(
    "listing.approved",
    safeHandler("savedSearch:listing.approved", async (event) => {
      await SavedSearchService.enqueueListingMatch({
        listingId: event.listingId,
        kind: SavedSearchMatchKind.NEW_LISTING,
      });
    }),
  );

  appEvents.on(
    "listing.priceDropped",
    safeHandler("savedSearch:listing.priceDropped", async (event) => {
      await SavedSearchService.enqueueListingMatch({
        listingId: event.listingId,
        kind: SavedSearchMatchKind.PRICE_DROP,
        oldPrice: event.oldPrice,
        newPrice: event.newPrice,
      });
    }),
  );
};
