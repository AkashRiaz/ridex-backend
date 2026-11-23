import { describe, expect, it } from "vitest";
import { isRateRangeValid } from "../src/app/module/financePartner/financePartner.utils";
import {
  CreateFinancePartnerZodSchema,
  UpdateFinancePartnerZodSchema,
} from "../src/app/module/financePartner/financePartner.validation";
import {
  buildLoanTerms,
  calculateEmi,
  canTransitionLoanLead,
  evaluateLoanLeadCreate,
  evaluateLoanTerms,
  isOpenLoanLeadStatus,
  loanLeadReference,
  statusTimestampField,
} from "../src/app/module/loanLead/loanLead.utils";
import {
  AssignLoanLeadZodSchema,
  CreateLoanLeadZodSchema,
  UpdateLoanLeadStatusZodSchema,
} from "../src/app/module/loanLead/loanLead.validation";

const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const SELLER_ID = "22222222-2222-4222-8222-222222222222";
const LISTING_ID = "33333333-3333-4333-8333-333333333333";

const liveListing = {
  status: "APPROVED",
  isDeleted: false,
  sellerId: SELLER_ID,
};

const partner = {
  name: "Swift Wheels Finance",
  interestRateMin: 9.5,
  interestRateMax: 13,
  minDownPaymentPercent: 20,
  maxTenureMonths: 36,
};

// ============================================
// EMI
// ============================================

describe("calculateEmi", () => {
  it("matches the reducing-balance formula", () => {
    // 100,000 at 12% a year for 12 months → 8,884.88
    expect(calculateEmi(100_000, 12, 12)).toBe(8884.88);
  });

  it("splits the principal evenly at 0%", () => {
    expect(calculateEmi(120_000, 0, 24)).toBe(5000);
  });

  it("returns 0 when there is nothing to borrow", () => {
    expect(calculateEmi(0, 12, 12)).toBe(0);
    expect(calculateEmi(-5, 12, 12)).toBe(0);
    expect(calculateEmi(1000, 12, 0)).toBe(0);
  });

  it("costs more interest over a longer tenure", () => {
    const short = buildLoanTerms({
      listingPrice: 300_000,
      downPayment: 60_000,
      tenureMonths: 12,
      interestRate: 12,
    });
    const long = buildLoanTerms({
      listingPrice: 300_000,
      downPayment: 60_000,
      tenureMonths: 36,
      interestRate: 12,
    });

    expect(short.loanAmount).toBe(240_000);
    expect(long.estimatedEmi).toBeLessThan(short.estimatedEmi);
    expect(long.totalInterest).toBeGreaterThan(short.totalInterest);
    expect(short.totalPayable).toBeCloseTo(short.estimatedEmi * 12, 2);
  });
});

// ============================================
// Terms
// ============================================

describe("evaluateLoanTerms", () => {
  const base = {
    listingPrice: 300_000,
    downPayment: 60_000,
    tenureMonths: 24,
    interestRate: 12,
    minDownPaymentPercent: 10,
  };

  it("accepts terms within the platform minimum", () => {
    expect(evaluateLoanTerms(base)).toEqual({ allowed: true });
  });

  it("rejects a down payment below the minimum percent", () => {
    const result = evaluateLoanTerms({ ...base, downPayment: 20_000 });

    expect(result).toMatchObject({
      allowed: false,
      code: "DOWN_PAYMENT_TOO_LOW",
    });
  });

  it("rejects a down payment that covers the whole price", () => {
    expect(evaluateLoanTerms({ ...base, downPayment: 300_000 })).toMatchObject({
      allowed: false,
      code: "DOWN_PAYMENT_TOO_HIGH",
    });
  });

  it("applies the partner's higher minimum down payment", () => {
    // 15% is fine for the platform (10%) but not for the partner (20%)
    const result = evaluateLoanTerms({
      ...base,
      downPayment: 45_000,
      partner,
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "DOWN_PAYMENT_TOO_LOW",
    });
    expect(result.allowed === false && result.reason).toContain(partner.name);
  });

  it("applies the partner's tenure and rate limits", () => {
    expect(
      evaluateLoanTerms({ ...base, tenureMonths: 48, partner }),
    ).toMatchObject({ allowed: false, code: "TENURE_TOO_LONG" });

    expect(
      evaluateLoanTerms({ ...base, interestRate: 15, partner }),
    ).toMatchObject({ allowed: false, code: "RATE_OUT_OF_RANGE" });

    expect(evaluateLoanTerms({ ...base, interestRate: 13, partner })).toEqual({
      allowed: true,
    });
  });
});

// ============================================
// Who can apply
// ============================================

describe("evaluateLoanLeadCreate", () => {
  const base = {
    listing: liveListing,
    buyerId: BUYER_ID,
    hasOpenLeadForListing: false,
    openLeadCount: 0,
    maxOpen: 5,
  };

  it("allows a buyer on a live listing", () => {
    expect(evaluateLoanLeadCreate(base)).toEqual({ allowed: true });
  });

  it("rejects missing, deleted and not-live listings", () => {
    expect(evaluateLoanLeadCreate({ ...base, listing: null })).toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
    expect(
      evaluateLoanLeadCreate({
        ...base,
        listing: { ...liveListing, isDeleted: true },
      }),
    ).toMatchObject({ code: "LISTING_NOT_FOUND" });
    expect(
      evaluateLoanLeadCreate({
        ...base,
        listing: { ...liveListing, status: "SOLD" },
      }),
    ).toMatchObject({ code: "LISTING_NOT_LIVE" });
  });

  it("rejects the seller's own listing", () => {
    expect(
      evaluateLoanLeadCreate({ ...base, buyerId: SELLER_ID }),
    ).toMatchObject({ code: "OWN_LISTING" });
  });

  it("allows one open request per listing", () => {
    expect(
      evaluateLoanLeadCreate({ ...base, hasOpenLeadForListing: true }),
    ).toMatchObject({ code: "DUPLICATE" });
  });

  it("caps open requests per buyer", () => {
    expect(evaluateLoanLeadCreate({ ...base, openLeadCount: 5 })).toMatchObject(
      { code: "LIMIT_REACHED" },
    );
    expect(evaluateLoanLeadCreate({ ...base, openLeadCount: 4 })).toEqual({
      allowed: true,
    });
  });
});

// ============================================
// Status workflow
// ============================================

describe("loan lead status transitions", () => {
  it("moves forward through the partner's process", () => {
    expect(canTransitionLoanLead("SENT_TO_PARTNER", "CONTACTED")).toBe(true);
    expect(canTransitionLoanLead("CONTACTED", "APPROVED")).toBe(true);
    expect(canTransitionLoanLead("APPROVED", "DISBURSED")).toBe(true);
  });

  it("sends only through assign, and closes new requests", () => {
    expect(canTransitionLoanLead("NEW", "SENT_TO_PARTNER")).toBe(false);
    expect(canTransitionLoanLead("NEW", "APPROVED")).toBe(false);
    expect(canTransitionLoanLead("NEW", "CLOSED")).toBe(true);
  });

  it("never moves back or out of a final status", () => {
    expect(canTransitionLoanLead("APPROVED", "CONTACTED")).toBe(false);
    expect(canTransitionLoanLead("CONTACTED", "DISBURSED")).toBe(false);

    for (const status of [
      "DISBURSED",
      "REJECTED",
      "WITHDRAWN",
      "CLOSED",
    ] as const) {
      expect(canTransitionLoanLead(status, "APPROVED")).toBe(false);
      expect(isOpenLoanLeadStatus(status)).toBe(false);
    }
  });

  it("stamps the right column", () => {
    expect(statusTimestampField("SENT_TO_PARTNER")).toBe("sentAt");
    expect(statusTimestampField("APPROVED")).toBe("approvedAt");
    expect(statusTimestampField("REJECTED")).toBeNull();
  });

  it("builds a short reference", () => {
    expect(loanLeadReference(LISTING_ID)).toBe("LL-33333333");
  });
});

// ============================================
// Validation
// ============================================

describe("loan lead validation", () => {
  const valid = {
    listingId: LISTING_ID,
    downPayment: 60000,
    tenureMonths: 24,
    interestRate: 12,
    fullName: "Demo Buyer",
    phone: "01712345678",
    employmentType: "SALARIED",
    consent: true,
  };

  it("accepts a valid request and normalizes the phone", () => {
    const result = CreateLoanLeadZodSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data?.phone).toBe("+8801712345678");
  });

  it("requires consent", () => {
    expect(
      CreateLoanLeadZodSchema.safeParse({ ...valid, consent: false }).success,
    ).toBe(false);
  });

  it("limits tenure and rate", () => {
    expect(
      CreateLoanLeadZodSchema.safeParse({ ...valid, tenureMonths: 3 }).success,
    ).toBe(false);
    expect(
      CreateLoanLeadZodSchema.safeParse({ ...valid, tenureMonths: 72 }).success,
    ).toBe(false);
    expect(
      CreateLoanLeadZodSchema.safeParse({ ...valid, interestRate: 45 }).success,
    ).toBe(false);
  });

  it("needs a reason the buyer sees when rejecting or closing", () => {
    expect(
      UpdateLoanLeadStatusZodSchema.safeParse({ status: "REJECTED" }).success,
    ).toBe(false);
    expect(
      UpdateLoanLeadStatusZodSchema.safeParse({
        status: "REJECTED",
        note: "Income too low for this amount",
      }).success,
    ).toBe(true);
    expect(
      UpdateLoanLeadStatusZodSchema.safeParse({ status: "CONTACTED" }).success,
    ).toBe(true);
  });

  it("does not allow SENT_TO_PARTNER through the status endpoint", () => {
    expect(
      UpdateLoanLeadStatusZodSchema.safeParse({ status: "SENT_TO_PARTNER" })
        .success,
    ).toBe(false);
    expect(AssignLoanLeadZodSchema.safeParse({}).success).toBe(false);
  });
});

describe("finance partner validation", () => {
  const valid = {
    name: "Swift Wheels Finance",
    contactEmail: "Leads@SwiftWheels.demo",
    interestRateMin: 9.5,
    interestRateMax: 13,
    minDownPaymentPercent: 20,
    maxTenureMonths: 36,
  };

  it("accepts a valid partner and lowercases the email", () => {
    const result = CreateFinancePartnerZodSchema.safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.data?.contactEmail).toBe("leads@swiftwheels.demo");
    expect(result.data?.isActive).toBe(true);
  });

  it("rejects an inverted rate range", () => {
    expect(
      CreateFinancePartnerZodSchema.safeParse({
        ...valid,
        interestRateMin: 14,
      }).success,
    ).toBe(false);
    expect(
      UpdateFinancePartnerZodSchema.safeParse({
        interestRateMin: 14,
        interestRateMax: 13,
      }).success,
    ).toBe(false);
  });

  it("checks a one-sided update against the stored range", () => {
    const stored = { interestRateMin: 9.5, interestRateMax: 13 };

    expect(isRateRangeValid(stored, { interestRateMin: 12 })).toBe(true);
    expect(isRateRangeValid(stored, { interestRateMin: 14 })).toBe(false);
    expect(isRateRangeValid(stored, { interestRateMax: 9 })).toBe(false);
  });

  it("caps tenure at the platform maximum", () => {
    expect(
      CreateFinancePartnerZodSchema.safeParse({
        ...valid,
        maxTenureMonths: 84,
      }).success,
    ).toBe(false);
  });
});
