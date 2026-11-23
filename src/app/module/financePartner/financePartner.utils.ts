import { Prisma } from "../../../generated/prisma/client";

// what anyone may see (EMI calculator presets); contact details stay admin-only
export const publicFinancePartnerSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  interestRateMin: true,
  interestRateMax: true,
  minDownPaymentPercent: true,
  maxTenureMonths: true,
} satisfies Prisma.FinancePartnerSelect;

type TDecimalLike = { toString(): string } | number;

// Decimal columns → numbers for JSON
export const toPartnerNumbers = <
  T extends { interestRateMin: TDecimalLike; interestRateMax: TDecimalLike },
>(
  partner: T,
) => ({
  ...partner,
  interestRateMin: Number(partner.interestRateMin),
  interestRateMax: Number(partner.interestRateMax),
});

/*
 * On update only one side of the range may be sent: check it against the
 * stored other side.
 */
export const isRateRangeValid = (
  current: { interestRateMin: number; interestRateMax: number },
  next: { interestRateMin?: number; interestRateMax?: number },
) =>
  (next.interestRateMin ?? current.interestRateMin) <=
  (next.interestRateMax ?? current.interestRateMax);
