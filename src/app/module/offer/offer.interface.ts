import { OfferStatus } from "../../../generated/prisma/enums";

export interface ICreateOfferPayload {
  listingId: string;
  amount: number;
  message?: string;
}

export interface ICounterOfferPayload {
  amount: number;
  message?: string;
}

export interface IDeclineOfferPayload {
  reason?: string;
}

// BullMQ "scheduled" queue: "offer-expire"
export interface IOfferExpireJob {
  offerId: string;
}

// what other modules (events, notifications) get about an offer
export interface IOfferRef {
  offerId: string;
  conversationId: string;
  listingId: string;
  listingTitle: string;
  buyerId: string;
  sellerId: string;
  proposedById: string;
  amount: number;
  status: OfferStatus;
  round: number;
}
