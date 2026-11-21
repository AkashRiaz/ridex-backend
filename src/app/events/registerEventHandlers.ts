import { config } from "../config";
import { TAppEvents, appEvents, safeHandler } from "./appEvents";
import { registerNotificationHandlers } from "./notificationHandlers";

/*
 * Development log for every event, plus the notification handlers
 * (Phase 1 · Part 5). Saved-search alert, social auto-post and
 * analytics handlers subscribe here later.
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
};
