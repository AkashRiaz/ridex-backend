import { LoanLeadService } from "../module/loanLead/loanLead.service";
import { appEvents, safeHandler } from "./appEvents";

/*
 * Listing gone → financing requests no partner has seen yet are closed
 * (the buyer is told through "loanLead.statusChanged"). Requests already
 * with a partner stay open. The partner email is queued by the service.
 */
export const registerLoanLeadHandlers = () => {
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
      safeHandler(`loanLead:${event}`, async (payload) => {
        await LoanLeadService.closeNewLoanLeadsForListing(
          payload.listingId,
          reason,
        );
      }),
    );
  }
};
