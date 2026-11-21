import { EventEmitter } from "node:events";
import { IOfferRef } from "../module/offer/offer.interface";
import { ITestRideRef } from "../module/testRide/testRide.interface";
import { TReminderKind } from "../module/testRide/testRide.utils";

/*
 * Internal domain events (core rule 5). Services emit AFTER commit;
 * notification / saved-search / social-post / analytics handlers subscribe.
 * Handlers must never throw into the emitter — wrap with `safeHandler`.
 */

type TListingRef = {
  listingId: string;
  sellerId: string;
  title: string;
  slug: string;
};

export type TAppEvents = {
  "listing.submitted": TListingRef;
  "listing.approved": TListingRef & { approvedById: string };
  "listing.rejected": TListingRef & { reason: string; rejectedById: string };
  "listing.sold": TListingRef;
  "listing.priceDropped": TListingRef & { oldPrice: number; newPrice: number };
  "listing.expired": TListingRef;
  "listing.deleted": TListingRef & { deletedById: string };
  "review.created": {
    reviewId: string;
    sellerId: string;
    reviewerId: string;
    rating: number;
  };
  "review.replied": { reviewId: string; sellerId: string; reviewerId: string };
  "report.created": {
    reportId: string;
    targetType: string;
    targetId: string;
    reporterId: string;
  };
  "report.resolved": {
    reportId: string;
    reporterId: string;
    targetType: string;
    status: "RESOLVED" | "DISMISSED";
    actionTaken: string | null;
  };
  "verification.submitted": { requestId: string; userId: string; type: string };
  "verification.approved": { requestId: string; userId: string; type: string };
  "verification.rejected": {
    requestId: string;
    userId: string;
    type: string;
    reason: string;
  };
  "message.created": {
    messageId: string;
    conversationId: string;
    senderId: string;
    recipientId: string;
  };
  "offer.created": IOfferRef;
  "offer.countered": IOfferRef & { counteredOfferId: string };
  "offer.accepted": IOfferRef;
  "offer.declined": IOfferRef & { reason: string | null };
  "offer.withdrawn": IOfferRef;
  "offer.expired": IOfferRef;
  "offer.cancelled": IOfferRef & { reason: string };
  "testRide.requested": ITestRideRef;
  "testRide.confirmed": ITestRideRef & { note: string };
  "testRide.declined": ITestRideRef & { reason: string };
  // cancelledById null = cancelled by the system (listing sold, removed, …)
  "testRide.cancelled": ITestRideRef & {
    cancelledById: string | null;
    reason: string;
  };
  "testRide.expired": ITestRideRef;
  "testRide.completed": ITestRideRef;
  "testRide.noShow": ITestRideRef;
  "testRide.reminder": ITestRideRef & { kind: TReminderKind };
};

class TypedEmitter {
  private emitter = new EventEmitter();

  emit<K extends keyof TAppEvents>(event: K, payload: TAppEvents[K]) {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof TAppEvents>(
    event: K,
    handler: (payload: TAppEvents[K]) => void | Promise<void>,
  ) {
    this.emitter.on(event, handler);
  }
}

export const appEvents = new TypedEmitter();

export const safeHandler =
  <T>(name: string, handler: (payload: T) => void | Promise<void>) =>
  async (payload: T) => {
    try {
      await handler(payload);
    } catch (error) {
      console.error(`Event handler "${name}" failed:`, error);
    }
  };
