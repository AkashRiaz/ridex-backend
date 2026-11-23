import { LoanLeadStatus, Role } from "../../../generated/prisma/enums";
import { CHAT_ROLES } from "../chat/chat.utils";

// ============================================
// Constants
// ============================================

// marketplace roles that can ask for financing (same as chat / offers)
export const LOAN_LEAD_ROLES: Role[] = CHAT_ROLES;

// leads hold income and phone data: admins only (moderators excluded)
export const LOAN_LEAD_ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export const LOAN_TENURE_MIN_MONTHS = 6;

export const LOAN_TENURE_MAX_MONTHS = 60;

export const LOAN_RATE_MAX_PERCENT = 40;

export const LOAN_NOTE_MAX = 500;

// still being worked on: one per buyer + listing, counted against the open limit
export const OPEN_LOAN_LEAD_STATUSES: LoanLeadStatus[] = [
  LoanLeadStatus.NEW,
  LoanLeadStatus.SENT_TO_PARTNER,
  LoanLeadStatus.CONTACTED,
  LoanLeadStatus.APPROVED,
];

export const isOpenLoanLeadStatus = (status: LoanLeadStatus) =>
  OPEN_LOAN_LEAD_STATUSES.includes(status);

// the buyer can withdraw until the partner has picked it up
export const WITHDRAWABLE_LOAN_LEAD_STATUSES: LoanLeadStatus[] = [
  LoanLeadStatus.NEW,
  LoanLeadStatus.SENT_TO_PARTNER,
];

// assign = send (or re-send to another partner) before the partner has called
export const ASSIGNABLE_LOAN_LEAD_STATUSES: LoanLeadStatus[] = [
  LoanLeadStatus.NEW,
  LoanLeadStatus.SENT_TO_PARTNER,
];

// ============================================
// EMI (same formula as the frontend calculator)
// ============================================

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/*
 * Reducing-balance EMI: P × r × (1 + r)^n / ((1 + r)^n − 1),
 * r = yearly rate / 12 / 100. A 0% rate splits the principal evenly.
 */
export const calculateEmi = (
  principal: number,
  yearlyRatePercent: number,
  months: number,
) => {
  if (principal <= 0 || months <= 0) return 0;

  const monthlyRate = yearlyRatePercent / 12 / 100;

  if (monthlyRate === 0) return roundMoney(principal / months);

  const growth = (1 + monthlyRate) ** months;

  return roundMoney((principal * monthlyRate * growth) / (growth - 1));
};

export const buildLoanTerms = (input: {
  listingPrice: number;
  downPayment: number;
  tenureMonths: number;
  interestRate: number;
}) => {
  const loanAmount = roundMoney(input.listingPrice - input.downPayment);
  const estimatedEmi = calculateEmi(
    loanAmount,
    input.interestRate,
    input.tenureMonths,
  );
  const totalPayable = roundMoney(estimatedEmi * input.tenureMonths);

  return {
    loanAmount,
    estimatedEmi,
    totalPayable,
    totalInterest: roundMoney(Math.max(0, totalPayable - loanAmount)),
  };
};

// ============================================
// Rules (pure, unit-tested)
// ============================================

export type TPartnerLimits = {
  name: string;
  interestRateMin: number;
  interestRateMax: number;
  minDownPaymentPercent: number;
  maxTenureMonths: number;
};

export type TLoanRuleResult =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };

const deny = (code: string, reason: string): TLoanRuleResult => ({
  allowed: false,
  code,
  reason,
});

/*
 * Terms against the platform minimum and, when the buyer picked one,
 * the partner's own limits.
 */
export const evaluateLoanTerms = (input: {
  listingPrice: number;
  downPayment: number;
  tenureMonths: number;
  interestRate: number;
  minDownPaymentPercent: number;
  partner?: TPartnerLimits | null;
}): TLoanRuleResult => {
  const { listingPrice, downPayment, tenureMonths, interestRate, partner } =
    input;

  if (downPayment >= listingPrice) {
    return deny(
      "DOWN_PAYMENT_TOO_HIGH",
      "The down payment must be less than the price. You don't need a loan for this listing.",
    );
  }

  const minPercent = Math.max(
    input.minDownPaymentPercent,
    partner?.minDownPaymentPercent ?? 0,
  );
  const minDownPayment = Math.ceil((listingPrice * minPercent) / 100);

  if (downPayment < minDownPayment) {
    return deny(
      "DOWN_PAYMENT_TOO_LOW",
      partner && partner.minDownPaymentPercent >= input.minDownPaymentPercent
        ? `${partner.name} needs a down payment of at least ${minPercent}% of the price.`
        : `The down payment must be at least ${minPercent}% of the price.`,
    );
  }

  if (partner && tenureMonths > partner.maxTenureMonths) {
    return deny(
      "TENURE_TOO_LONG",
      `${partner.name} lends for at most ${partner.maxTenureMonths} months.`,
    );
  }

  if (
    partner &&
    (interestRate < partner.interestRateMin ||
      interestRate > partner.interestRateMax)
  ) {
    return deny(
      "RATE_OUT_OF_RANGE",
      `${partner.name} offers ${partner.interestRateMin}%–${partner.interestRateMax}% a year.`,
    );
  }

  return { allowed: true };
};

/*
 * Who may apply for a listing, and how many open requests they may keep.
 */
export const evaluateLoanLeadCreate = (input: {
  listing: { status: string; isDeleted: boolean; sellerId: string } | null;
  buyerId: string;
  hasOpenLeadForListing: boolean;
  openLeadCount: number;
  maxOpen: number;
}): TLoanRuleResult => {
  const { listing } = input;

  if (!listing || listing.isDeleted) {
    return deny("LISTING_NOT_FOUND", "Listing not found");
  }

  if (listing.sellerId === input.buyerId) {
    return deny(
      "OWN_LISTING",
      "You cannot request financing for your own listing",
    );
  }

  if (listing.status !== "APPROVED") {
    return deny(
      "LISTING_NOT_LIVE",
      "Financing can only be requested for live listings",
    );
  }

  if (input.hasOpenLeadForListing) {
    return deny(
      "DUPLICATE",
      "You already have an open financing request for this listing",
    );
  }

  if (input.openLeadCount >= input.maxOpen) {
    return deny(
      "LIMIT_REACHED",
      `You can have at most ${input.maxOpen} open financing requests. Withdraw one to send another.`,
    );
  }

  return { allowed: true };
};

/*
 * Admin status changes after a lead is with a partner. Sending
 * (→ SENT_TO_PARTNER) goes through assign, never through this map.
 */
export const LOAN_LEAD_TRANSITIONS: Record<LoanLeadStatus, LoanLeadStatus[]> = {
  NEW: [LoanLeadStatus.CLOSED],
  SENT_TO_PARTNER: [
    LoanLeadStatus.CONTACTED,
    LoanLeadStatus.APPROVED,
    LoanLeadStatus.REJECTED,
    LoanLeadStatus.CLOSED,
  ],
  CONTACTED: [
    LoanLeadStatus.APPROVED,
    LoanLeadStatus.REJECTED,
    LoanLeadStatus.CLOSED,
  ],
  APPROVED: [
    LoanLeadStatus.DISBURSED,
    LoanLeadStatus.REJECTED,
    LoanLeadStatus.CLOSED,
  ],
  DISBURSED: [],
  REJECTED: [],
  WITHDRAWN: [],
  CLOSED: [],
};

export const canTransitionLoanLead = (
  from: LoanLeadStatus,
  to: LoanLeadStatus,
) => LOAN_LEAD_TRANSITIONS[from].includes(to);

// statuses that end the request
export const TERMINAL_LOAN_LEAD_STATUSES: LoanLeadStatus[] = [
  LoanLeadStatus.DISBURSED,
  LoanLeadStatus.REJECTED,
  LoanLeadStatus.WITHDRAWN,
  LoanLeadStatus.CLOSED,
];

/*
 * Timestamp column set when a lead enters a status.
 */
export const statusTimestampField = (status: LoanLeadStatus) => {
  switch (status) {
    case LoanLeadStatus.SENT_TO_PARTNER:
      return "sentAt" as const;
    case LoanLeadStatus.CONTACTED:
      return "contactedAt" as const;
    case LoanLeadStatus.APPROVED:
      return "approvedAt" as const;
    case LoanLeadStatus.DISBURSED:
      return "disbursedAt" as const;
    default:
      return null;
  }
};

// ============================================
// Copy
// ============================================

export const LOAN_LEAD_STATUS_TEXT: Record<LoanLeadStatus, string> = {
  NEW: "received",
  SENT_TO_PARTNER: "sent to a finance partner",
  CONTACTED: "being reviewed by the partner",
  APPROVED: "approved",
  DISBURSED: "disbursed",
  REJECTED: "not approved",
  WITHDRAWN: "withdrawn",
  CLOSED: "closed",
};

// short reference shown to buyers, admins and partners: "LL-3F9A2C1B"
export const loanLeadReference = (id: string) =>
  `LL-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
