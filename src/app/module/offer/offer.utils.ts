import {
  ListingStatus,
  OfferStatus,
  Role,
} from "../../../generated/prisma/enums";
import { formatPrice } from "../../helper/formatPrice";
import { CHAT_ROLES } from "../chat/chat.utils";

// ============================================
// Constants
// ============================================

// offers live inside chat, so the same marketplace roles take part
export const OFFER_ROLES: Role[] = CHAT_ROLES;

export const MAX_OFFER_MESSAGE_LENGTH = 500;

export const MAX_DECLINE_REASON_LENGTH = 300;

// new offers (not counters) per user per hour
export const OFFER_RATE_LIMIT_PER_HOUR = 20;

export const OFFER_SWEEP_BATCH_LIMIT = 200;

// statuses a response can still change
export const OPEN_OFFER_STATUSES: OfferStatus[] = [OfferStatus.PENDING];

// advisory lock namespace (pg_advisory_xact_lock(namespace, hashtext(id)))
export const OFFER_LOCK_NAMESPACE = 1;

export const offerRateKey = (userId: string) => `offer-rate:${userId}`;

// BullMQ custom job ids must not contain ":"
export const offerExpireJobId = (offerId: string) => `offer-expire-${offerId}`;

// ============================================
// Small helpers
// ============================================

export const minOfferAmount = (price: number, minPercent: number) =>
  Math.ceil((price * minPercent) / 100);

export const offerExpiryDate = (hours: number, from = new Date()) =>
  new Date(from.getTime() + hours * 60 * 60 * 1000);

// chat list preview and email digest line for an OFFER card
export const offerPreview = (amount: number, note = "") => {
  const base = `💰 Offer: ${formatPrice(amount)}`;
  const text = note.replace(/\s+/g, " ").trim();

  return text ? `${base} — ${text}` : base;
};

export type TOfferSide = "buyer" | "seller";

type TOfferParticipants = {
  buyerId: string;
  sellerId: string;
  proposedById: string;
};

export const offerSideOf = (
  offer: Pick<TOfferParticipants, "buyerId" | "sellerId">,
  userId: string,
): TOfferSide | null => {
  if (offer.buyerId === userId) return "buyer";
  if (offer.sellerId === userId) return "seller";
  return null;
};

// the participant who has to answer the offer
export const offerRecipientId = (offer: TOfferParticipants) =>
  offer.proposedById === offer.buyerId ? offer.sellerId : offer.buyerId;

// ============================================
// Rules (pure, unit-tested)
// ============================================

type TRuleResult<TCode extends string> =
  | { allowed: true }
  | { allowed: false; code: TCode; reason: string };

type TOfferListing = {
  sellerId: string;
  status: ListingStatus;
  isDeleted: boolean;
  isNegotiable: boolean;
  price: number;
};

/*
 * A buyer opens a negotiation. The listing must be live and negotiable,
 * the amount must sit between the floor (OFFER_MIN_PERCENT of the price)
 * and the asking price, and the thread may not already have an open or
 * accepted offer.
 */
export const evaluateMakeOffer = (input: {
  userId: string;
  listing: TOfferListing | null;
  amount: number;
  minPercent: number;
  hasOpenOffer: boolean;
  hasAcceptedOffer: boolean;
}): TRuleResult<
  | "LISTING_NOT_FOUND"
  | "OWN_LISTING"
  | "LISTING_UNAVAILABLE"
  | "NOT_NEGOTIABLE"
  | "OPEN_OFFER_EXISTS"
  | "ALREADY_ACCEPTED"
  | "AMOUNT_TOO_LOW"
  | "AMOUNT_TOO_HIGH"
> => {
  const { listing } = input;

  if (!listing || listing.isDeleted) {
    return {
      allowed: false,
      code: "LISTING_NOT_FOUND",
      reason: "Listing not found",
    };
  }

  if (listing.sellerId === input.userId) {
    return {
      allowed: false,
      code: "OWN_LISTING",
      reason: "You cannot make an offer on your own listing",
    };
  }

  if (listing.status !== ListingStatus.APPROVED) {
    return {
      allowed: false,
      code: "LISTING_UNAVAILABLE",
      reason: "This listing is not accepting offers right now",
    };
  }

  if (!listing.isNegotiable) {
    return {
      allowed: false,
      code: "NOT_NEGOTIABLE",
      reason: "The seller has set a fixed price for this listing",
    };
  }

  if (input.hasAcceptedOffer) {
    return {
      allowed: false,
      code: "ALREADY_ACCEPTED",
      reason: "An offer in this conversation was already accepted",
    };
  }

  if (input.hasOpenOffer) {
    return {
      allowed: false,
      code: "OPEN_OFFER_EXISTS",
      reason:
        "There is already an open offer in this conversation. Wait for a reply or withdraw it first.",
    };
  }

  const floor = minOfferAmount(listing.price, input.minPercent);

  if (input.amount < floor) {
    return {
      allowed: false,
      code: "AMOUNT_TOO_LOW",
      reason: `The lowest offer for this listing is ${formatPrice(floor)}`,
    };
  }

  if (input.amount > listing.price) {
    return {
      allowed: false,
      code: "AMOUNT_TOO_HIGH",
      reason: `An offer cannot be above the asking price (${formatPrice(listing.price)})`,
    };
  }

  return { allowed: true };
};

export type TOfferAction = "counter" | "accept" | "decline" | "withdraw";

/*
 * Who may do what with an offer:
 *   accept / decline / counter → the recipient, while PENDING and not past expiresAt
 *   withdraw                   → the proposer, while PENDING
 * Accept and counter also need the listing to be live.
 */
export const evaluateOfferAction = (input: {
  action: TOfferAction;
  userId: string;
  offer: TOfferParticipants & { status: OfferStatus; expiresAt: Date };
  listing: { status: ListingStatus; isDeleted: boolean };
  now?: Date;
}): TRuleResult<
  "NOT_FOUND" | "NOT_ALLOWED" | "NOT_OPEN" | "EXPIRED" | "LISTING_UNAVAILABLE"
> => {
  const { offer, action } = input;
  const now = input.now ?? new Date();

  if (!offerSideOf(offer, input.userId)) {
    return { allowed: false, code: "NOT_FOUND", reason: "Offer not found" };
  }

  if (offer.status !== OfferStatus.PENDING) {
    return {
      allowed: false,
      code: "NOT_OPEN",
      reason: `This offer is already ${offer.status.toLowerCase()}`,
    };
  }

  const isProposer = offer.proposedById === input.userId;

  if (action === "withdraw") {
    return isProposer
      ? { allowed: true }
      : {
          allowed: false,
          code: "NOT_ALLOWED",
          reason: "Only the person who made the offer can withdraw it",
        };
  }

  if (isProposer) {
    return {
      allowed: false,
      code: "NOT_ALLOWED",
      reason: "You cannot respond to your own offer",
    };
  }

  if (offer.expiresAt.getTime() <= now.getTime()) {
    return {
      allowed: false,
      code: "EXPIRED",
      reason: "This offer has expired",
    };
  }

  if (
    action !== "decline" &&
    (input.listing.isDeleted || input.listing.status !== ListingStatus.APPROVED)
  ) {
    return {
      allowed: false,
      code: "LISTING_UNAVAILABLE",
      reason: "This listing is not accepting offers right now",
    };
  }

  return { allowed: true };
};

/*
 * A counter must move towards the other side:
 *   seller → above the buyer's offer, below their own last counter
 *            (or up to the asking price on the first counter)
 *   buyer  → above their own last offer, below the seller's counter
 * The floor (OFFER_MIN_PERCENT) and OFFER_MAX_ROUNDS always apply.
 */
export const evaluateCounterAmount = (input: {
  counterSide: TOfferSide;
  amount: number;
  // the offer being countered
  counteredAmount: number;
  // the counterer's own previous proposal in this chain, if any
  previousOwnAmount: number | null;
  listingPrice: number;
  minPercent: number;
  nextRound: number;
  maxRounds: number;
}): TRuleResult<
  "TOO_MANY_ROUNDS" | "AMOUNT_TOO_LOW" | "AMOUNT_OUT_OF_RANGE"
> => {
  if (input.nextRound > input.maxRounds) {
    return {
      allowed: false,
      code: "TOO_MANY_ROUNDS",
      reason: `This negotiation reached ${input.maxRounds} rounds. Accept or decline the last offer.`,
    };
  }

  const floor = minOfferAmount(input.listingPrice, input.minPercent);

  if (input.amount < floor) {
    return {
      allowed: false,
      code: "AMOUNT_TOO_LOW",
      reason: `The lowest offer for this listing is ${formatPrice(floor)}`,
    };
  }

  if (input.counterSide === "seller") {
    const ceiling = input.previousOwnAmount ?? input.listingPrice;
    const ceilingInclusive = input.previousOwnAmount === null;
    const withinCeiling = ceilingInclusive
      ? input.amount <= ceiling
      : input.amount < ceiling;

    if (input.amount <= input.counteredAmount || !withinCeiling) {
      return {
        allowed: false,
        code: "AMOUNT_OUT_OF_RANGE",
        reason: ceilingInclusive
          ? `Your counter must be above ${formatPrice(input.counteredAmount)} and at most ${formatPrice(ceiling)}`
          : `Your counter must be between ${formatPrice(input.counteredAmount)} and ${formatPrice(ceiling)}`,
      };
    }

    return { allowed: true };
  }

  const lowest = input.previousOwnAmount ?? floor - 1;

  if (input.amount <= lowest || input.amount >= input.counteredAmount) {
    return {
      allowed: false,
      code: "AMOUNT_OUT_OF_RANGE",
      reason: `Your counter must be between ${formatPrice(lowest)} and ${formatPrice(input.counteredAmount)}`,
    };
  }

  return { allowed: true };
};

// ============================================
// Notice texts (SYSTEM messages in the thread)
// ============================================

export const offerNoticeText = (
  event: "accepted" | "declined" | "withdrawn" | "expired" | "cancelled",
  amount: number,
  extra?: string | null,
) => {
  const price = formatPrice(amount);

  switch (event) {
    case "accepted":
      return `Offer of ${price} accepted. Arrange the payment and handover in this chat.`;
    case "declined":
      return extra
        ? `Offer of ${price} declined: ${extra}`
        : `Offer of ${price} declined.`;
    case "withdrawn":
      return `Offer of ${price} withdrawn.`;
    case "expired":
      return `Offer of ${price} expired without a reply.`;
    case "cancelled":
      return extra
        ? `Offer of ${price} closed: ${extra}`
        : `Offer of ${price} closed.`;
  }
};
