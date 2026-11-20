import { EventEmitter } from "node:events";

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
};

class TypedEmitter {
  private emitter = new EventEmitter();

  emit<K extends keyof TAppEvents>(event: K, payload: TAppEvents[K]) {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof TAppEvents>(event: K, handler: (payload: TAppEvents[K]) => void | Promise<void>) {
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
