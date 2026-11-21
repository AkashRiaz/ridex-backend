import { TestRideService } from "../module/testRide/testRide.service";
import { appEvents, safeHandler } from "./appEvents";

/*
 * Listing lifecycle → upcoming test rides on it are cancelled by the system.
 * Notifications come from "testRide.cancelled".
 */
export const registerTestRideHandlers = () => {
  const reasons = {
    "listing.sold": "the listing was sold",
    "listing.expired": "the listing expired",
    "listing.rejected": "the listing was taken down",
    "listing.deleted": "the listing was removed",
  } as const;

  for (const [event, reason] of Object.entries(reasons) as [
    keyof typeof reasons,
    string,
  ][]) {
    appEvents.on(
      event,
      safeHandler(`testRide:${event}`, async (payload) => {
        await TestRideService.cancelActiveTestRidesForListing(
          payload.listingId,
          reason,
        );
      }),
    );
  }
};
