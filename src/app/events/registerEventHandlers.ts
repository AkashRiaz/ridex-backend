import { config } from "../config";
import { TAppEvents, appEvents, safeHandler } from "./appEvents";

/*
 * Phase 1 · Part 3: log only. Notification, saved-search alert,
 * social auto-post and analytics handlers subscribe here later.
 */
export const registerEventHandlers = () => {
  const events: (keyof TAppEvents)[] = [
    "listing.submitted",
    "listing.approved",
    "listing.rejected",
    "listing.sold",
    "listing.priceDropped",
    "listing.expired",
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
};
