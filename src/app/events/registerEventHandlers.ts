import { config } from "../config";
import { TAppEvents, appEvents, safeHandler } from "./appEvents";
import { registerLoanLeadHandlers } from "./loanLeadHandlers";
import { registerNotificationHandlers } from "./notificationHandlers";
import { registerOfferHandlers } from "./offerHandlers";
import { registerSavedSearchHandlers } from "./savedSearchHandlers";
import { registerTestRideHandlers } from "./testRideHandlers";

/*
 * Development log for every event, plus the notification handlers
 * (Phase 1 · Part 5), offers, test rides and saved-search alerts
 * and financing requests (Phase 2). Social auto-post and analytics handlers subscribe here later.
 */
export const registerEventHandlers = () => {
  const events: (keyof TAppEvents)[] = [
    "listing.submitted",
    "listing.approved",
    "listing.rejected",
    "listing.sold",
    "listing.priceDropped",
    "listing.expired",
    "review.created",
    "review.replied",
    "report.created",
    "report.resolved",
    "verification.submitted",
    "verification.approved",
    "verification.rejected",
    "message.created",
    "listing.deleted",
    "offer.created",
    "offer.countered",
    "offer.accepted",
    "offer.declined",
    "offer.withdrawn",
    "offer.expired",
    "offer.cancelled",
    "testRide.requested",
    "testRide.confirmed",
    "testRide.declined",
    "testRide.cancelled",
    "testRide.expired",
    "testRide.completed",
    "testRide.noShow",
    "testRide.reminder",
    "savedSearch.matched",
    "savedSearch.digest",
    "loanLead.submitted",
    "loanLead.withdrawn",
    "loanLead.sentToPartner",
    "loanLead.statusChanged",
  ];

  for (const event of events) {
    appEvents.on(
      event,
      safeHandler(`log:${event}`, (payload) => {
        if (config.node_env === "development") {
          console.log(`[event] ${event}`, JSON.stringify(payload));
        }
      }),
    );
  }

  registerNotificationHandlers();
  registerOfferHandlers();
  registerTestRideHandlers();
  registerSavedSearchHandlers();
  registerLoanLeadHandlers();
};
