import { describe, expect, it } from "vitest";
import { ListingStatus, OfferStatus } from "../src/generated/prisma/enums";
import {
  evaluateCounterAmount,
  evaluateMakeOffer,
  evaluateOfferAction,
  minOfferAmount,
  offerExpireJobId,
  offerExpiryDate,
  offerPreview,
  offerRecipientId,
  offerSideOf,
} from "../src/app/module/offer/offer.utils";
import {
  CounterOfferZodSchema,
  CreateOfferZodSchema,
  OfferQueryZodSchema,
} from "../src/app/module/offer/offer.validation";

const BUYER = "buyer-1";
const SELLER = "seller-1";

const liveListing = {
  sellerId: SELLER,
  status: ListingStatus.APPROVED,
  isDeleted: false,
  isNegotiable: true,
  price: 200_000,
};

const makeInput = (
  overrides: Partial<Parameters<typeof evaluateMakeOffer>[0]> = {},
) => ({
  userId: BUYER,
  listing: liveListing,
  amount: 180_000,
  minPercent: 50,
  hasOpenOffer: false,
  hasAcceptedOffer: false,
  ...overrides,
});

const pendingOffer = (overrides: Record<string, unknown> = {}) => ({
  buyerId: BUYER,
  sellerId: SELLER,
  proposedById: BUYER,
  status: OfferStatus.PENDING,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  ...overrides,
});

const liveState: { status: ListingStatus; isDeleted: boolean } = {
  status: ListingStatus.APPROVED,
  isDeleted: false,
};

const codeOf = (result: { allowed: boolean; code?: string }) =>
  result.allowed ? "OK" : result.code;

describe("offer helpers", () => {
  it("rounds the floor up", () => {
    expect(minOfferAmount(200_000, 50)).toBe(100_000);
    expect(minOfferAmount(99_999, 50)).toBe(50_000);
  });

  it("adds the expiry window", () => {
    const from = new Date("2026-11-21T10:00:00.000Z");
    expect(offerExpiryDate(48, from).toISOString()).toBe(
      "2026-11-23T10:00:00.000Z",
    );
  });

  it("finds sides and the recipient", () => {
    const offer = pendingOffer();
    expect(offerSideOf(offer, BUYER)).toBe("buyer");
    expect(offerSideOf(offer, SELLER)).toBe("seller");
    expect(offerSideOf(offer, "stranger")).toBeNull();
    expect(offerRecipientId(offer)).toBe(SELLER);
    expect(offerRecipientId(pendingOffer({ proposedById: SELLER }))).toBe(
      BUYER,
    );
  });

  it("builds previews and job ids without colons", () => {
    expect(offerPreview(185_000)).toMatch(/^💰 Offer: /);
    expect(offerPreview(185_000, "  cash \n today ")).toMatch(/— cash today$/);
    expect(offerExpireJobId("abc")).not.toContain(":");
  });
});

describe("evaluateMakeOffer", () => {
  it("allows a fair offer on a live, negotiable listing", () => {
    expect(codeOf(evaluateMakeOffer(makeInput()))).toBe("OK");
    // the asking price itself is allowed
    expect(codeOf(evaluateMakeOffer(makeInput({ amount: 200_000 })))).toBe(
      "OK",
    );
  });

  it("rejects missing, own, unavailable and fixed-price listings", () => {
    expect(codeOf(evaluateMakeOffer(makeInput({ listing: null })))).toBe(
      "LISTING_NOT_FOUND",
    );
    expect(
      codeOf(
        evaluateMakeOffer(
          makeInput({ listing: { ...liveListing, isDeleted: true } }),
        ),
      ),
    ).toBe("LISTING_NOT_FOUND");
    expect(codeOf(evaluateMakeOffer(makeInput({ userId: SELLER })))).toBe(
      "OWN_LISTING",
    );
    for (const status of [
      ListingStatus.SOLD,
      ListingStatus.PENDING,
      ListingStatus.EXPIRED,
      ListingStatus.DRAFT,
    ]) {
      expect(
        codeOf(
          evaluateMakeOffer(makeInput({ listing: { ...liveListing, status } })),
        ),
      ).toBe("LISTING_UNAVAILABLE");
    }
    expect(
      codeOf(
        evaluateMakeOffer(
          makeInput({ listing: { ...liveListing, isNegotiable: false } }),
        ),
      ),
    ).toBe("NOT_NEGOTIABLE");
  });

  it("allows one open offer per conversation and none after an accept", () => {
    expect(codeOf(evaluateMakeOffer(makeInput({ hasOpenOffer: true })))).toBe(
      "OPEN_OFFER_EXISTS",
    );
    expect(
      codeOf(evaluateMakeOffer(makeInput({ hasAcceptedOffer: true }))),
    ).toBe("ALREADY_ACCEPTED");
  });

  it("enforces the floor and the asking price", () => {
    expect(codeOf(evaluateMakeOffer(makeInput({ amount: 99_999 })))).toBe(
      "AMOUNT_TOO_LOW",
    );
    expect(codeOf(evaluateMakeOffer(makeInput({ amount: 100_000 })))).toBe(
      "OK",
    );
    expect(codeOf(evaluateMakeOffer(makeInput({ amount: 200_001 })))).toBe(
      "AMOUNT_TOO_HIGH",
    );
  });
});

describe("evaluateOfferAction", () => {
  const run = (
    action: Parameters<typeof evaluateOfferAction>[0]["action"],
    userId: string,
    offer = pendingOffer(),
    listing = liveState,
  ) => codeOf(evaluateOfferAction({ action, userId, offer, listing }));

  it("lets only the recipient accept, decline or counter", () => {
    for (const action of ["accept", "decline", "counter"] as const) {
      expect(run(action, SELLER)).toBe("OK");
      expect(run(action, BUYER)).toBe("NOT_ALLOWED");
    }
  });

  it("lets only the proposer withdraw", () => {
    expect(run("withdraw", BUYER)).toBe("OK");
    expect(run("withdraw", SELLER)).toBe("NOT_ALLOWED");
  });

  it("hides offers from outsiders", () => {
    expect(run("accept", "stranger")).toBe("NOT_FOUND");
  });

  it("only changes PENDING offers", () => {
    for (const status of [
      OfferStatus.ACCEPTED,
      OfferStatus.DECLINED,
      OfferStatus.COUNTERED,
      OfferStatus.WITHDRAWN,
      OfferStatus.EXPIRED,
      OfferStatus.CANCELLED,
    ]) {
      expect(run("accept", SELLER, pendingOffer({ status }))).toBe("NOT_OPEN");
      expect(run("withdraw", BUYER, pendingOffer({ status }))).toBe("NOT_OPEN");
    }
  });

  it("blocks answers after expiresAt, but still allows a withdraw", () => {
    const expired = pendingOffer({ expiresAt: new Date(Date.now() - 1000) });
    expect(run("accept", SELLER, expired)).toBe("EXPIRED");
    expect(run("counter", SELLER, expired)).toBe("EXPIRED");
    expect(run("withdraw", BUYER, expired)).toBe("OK");
  });

  it("needs a live listing to accept or counter, not to decline", () => {
    const sold = { status: ListingStatus.SOLD, isDeleted: false };
    expect(run("accept", SELLER, pendingOffer(), sold)).toBe(
      "LISTING_UNAVAILABLE",
    );
    expect(run("counter", SELLER, pendingOffer(), sold)).toBe(
      "LISTING_UNAVAILABLE",
    );
    expect(run("decline", SELLER, pendingOffer(), sold)).toBe("OK");
  });
});

describe("evaluateCounterAmount", () => {
  const base = {
    listingPrice: 200_000,
    minPercent: 50,
    nextRound: 2,
    maxRounds: 5,
  };

  it("seller's first counter: above the offer, up to the asking price", () => {
    const seller = (amount: number) =>
      codeOf(
        evaluateCounterAmount({
          ...base,
          counterSide: "seller",
          amount,
          counteredAmount: 150_000,
          previousOwnAmount: null,
        }),
      );

    expect(seller(190_000)).toBe("OK");
    expect(seller(200_000)).toBe("OK");
    expect(seller(150_000)).toBe("AMOUNT_OUT_OF_RANGE");
    expect(seller(200_001)).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("seller's later counter must come down from their last one", () => {
    const seller = (amount: number) =>
      codeOf(
        evaluateCounterAmount({
          ...base,
          nextRound: 4,
          counterSide: "seller",
          amount,
          counteredAmount: 170_000,
          previousOwnAmount: 190_000,
        }),
      );

    expect(seller(180_000)).toBe("OK");
    expect(seller(190_000)).toBe("AMOUNT_OUT_OF_RANGE");
    expect(seller(170_000)).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("buyer's counter must go up from their last offer, below the seller's", () => {
    const buyer = (amount: number) =>
      codeOf(
        evaluateCounterAmount({
          ...base,
          nextRound: 3,
          counterSide: "buyer",
          amount,
          counteredAmount: 190_000,
          previousOwnAmount: 150_000,
        }),
      );

    expect(buyer(170_000)).toBe("OK");
    expect(buyer(150_000)).toBe("AMOUNT_OUT_OF_RANGE");
    expect(buyer(190_000)).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("applies the floor and the round limit", () => {
    expect(
      codeOf(
        evaluateCounterAmount({
          ...base,
          counterSide: "buyer",
          amount: 90_000,
          counteredAmount: 190_000,
          previousOwnAmount: 80_000,
        }),
      ),
    ).toBe("AMOUNT_TOO_LOW");
    expect(
      codeOf(
        evaluateCounterAmount({
          ...base,
          nextRound: 6,
          counterSide: "seller",
          amount: 190_000,
          counteredAmount: 150_000,
          previousOwnAmount: null,
        }),
      ),
    ).toBe("TOO_MANY_ROUNDS");
  });
});

describe("offer validation", () => {
  const listingId = "4f9c0d7e-1c1f-4c55-9a3e-2d6b6d1f8a10";

  it("accepts a valid offer and coerces the amount", () => {
    const result = CreateOfferZodSchema.safeParse({
      listingId,
      amount: "185000",
      message: "  Cash today  ",
    });
    expect(result.success).toBe(true);
    expect(result.data?.amount).toBe(185_000);
    expect(result.data?.message).toBe("Cash today");
  });

  it("rejects bad ids, fractions, zero and long notes", () => {
    expect(
      CreateOfferZodSchema.safeParse({ listingId: "x", amount: 1 }).success,
    ).toBe(false);
    expect(CounterOfferZodSchema.safeParse({ amount: 1.5 }).success).toBe(
      false,
    );
    expect(CounterOfferZodSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(
      CounterOfferZodSchema.safeParse({ amount: 1, message: "a".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("validates list filters", () => {
    expect(
      OfferQueryZodSchema.safeParse({ as: "seller", status: "PENDING" })
        .success,
    ).toBe(true);
    expect(OfferQueryZodSchema.safeParse({ as: "admin" }).success).toBe(false);
    expect(OfferQueryZodSchema.safeParse({ status: "OPEN" }).success).toBe(
      false,
    );
  });
});
